# Deploying YouEnjoyMyFamily

One household, one AWS account, three things to deploy: the backend, the
web app, and (optionally) the Alexa skill. Start to finish this is about
45 minutes the first time, most of it waiting for CloudFront.

Everything below runs on **your** machine with **your** AWS credentials.
Nothing here can be run from a CI sandbox, and nothing in this repo has
ever held a credential of yours.

---

## 0. Before you start

You need:

| | |
|---|---|
| **AWS account** | with credentials configured (`aws configure`) |
| **AWS SAM CLI** | [install guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) — `brew install aws-sam-cli` on a Mac |
| **Node.js 20+** | `node --version` |
| **Instacart API key** | *optional* — only grocery checkout needs it |
| **Google OAuth client** | *optional* — only calendar sync needs it |

Check the template before you spend anything. This runs in a second and
needs no AWS access at all:

```bash
cd backend
npm install
npm run verify:template
```

It prints the SSM parameters the stack expects, and fails loudly on a
route pointing at a logical id that doesn't exist — which is exactly the
bug that once got through typecheck, lint and 150 tests and only showed
up as a rollback four minutes into a deploy.

---

## 1. Create the SSM parameters

The stack resolves these **at deploy time**. A missing one doesn't warn —
it rolls the whole stack back. `npm run verify:template` lists them; as of
now they are:

```bash
# Only needed if you want grocery checkout to work.
aws ssm put-parameter --name /youenjoymyfamily/instacart/api-key \
  --type SecureString --value "<your Instacart key>"

# Only needed if you want Google Calendar sync.
aws ssm put-parameter --name /youenjoymyfamily/google/client-id \
  --type String --value "<your client id>"
aws ssm put-parameter --name /youenjoymyfamily/google/client-secret \
  --type SecureString --value "<your client secret>"
```

**Don't have them yet?** Put a placeholder in each rather than skipping
them — the deploy needs the parameter to *exist*, not to be valid. Meal
planning, chores, routines, gems and focus blocks all work without either
integration; you'll just get an error if you press "checkout".

```bash
for p in instacart/api-key google/client-secret; do
  aws ssm put-parameter --name /youenjoymyfamily/$p --type SecureString --value "placeholder"
done
aws ssm put-parameter --name /youenjoymyfamily/google/client-id --type String --value "placeholder"
```

---

## 2. Deploy the backend

```bash
cd backend
npm run build      # sam build — esbuild-bundles each handler
npm run deploy     # sam deploy --guided, first time only
```

`--guided` asks a handful of questions. The answers that matter:

- **Stack name** — `youenjoymyfamily` is fine
- **Region** — pick the one nearest you; it's where your family's data lives
- **Parameter Stage** — `prod`
- **Confirm changes before deploy** — `Y` the first time, so you see what's being created
- **Allow SAM CLI IAM role creation** — `Y` (it needs to create the Lambda execution roles)
- **Save arguments to samconfig.toml** — `Y`, so later deploys are just `sam deploy`

It writes `samconfig.toml`. That file holds no secrets, but it isn't in
the repo — keep it locally.

When it finishes it prints the outputs. **Save these:**

```
ApiUrl                  https://xxxxxxxx.execute-api.<region>.amazonaws.com/prod
FrontendBucketName      youenjoymyfamily-frontend-xxxxxxxx
FrontendDistributionId  EXXXXXXXXXXXXX
FrontendUrl             https://xxxxxxxxxxxxxx.cloudfront.net
```

---

## 3. Create your family, and keep the key

```bash
curl -X POST "<ApiUrl>/families" \
  -H "Content-Type: application/json" \
  -d '{"name": "The Peals"}'
```

```json
{ "familyId": "fam_01J...", "apiKey": "fk_live_..." }
```

> **The `apiKey` is shown exactly once.** Only its SHA-256 hash is stored,
> so it cannot be recovered — losing it means creating a new family and
> starting the data again. Put it in a password manager now.
>
> **Do not put it in an `.env` file for the frontend build.** An earlier
> version of the docs said to, and that is precisely how it ended up
> compiled into a public JavaScript bundle: Vite inlines
> `import.meta.env.*` at build time. Each screen is linked on the device
> instead — see step 5.

---

## 4. Put the web app up

```bash
cd ../frontend
npm install
VITE_API_BASE_URL="<ApiUrl>" npm run build     # no key — see above

# Hashed assets can cache forever. index.html and the manifest must not,
# or the family keeps loading last week's build.
aws s3 sync dist/ s3://<FrontendBucketName>/ --delete \
  --exclude index.html --exclude manifest.webmanifest \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://<FrontendBucketName>/index.html \
  --cache-control "no-cache"
aws s3 cp dist/manifest.webmanifest s3://<FrontendBucketName>/manifest.webmanifest \
  --cache-control "no-cache"

aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"
```

The invalidation takes a few minutes. Meanwhile, confirm the key really
didn't ship:

```bash
npm run verify:bundle
```

---

## 5. Link the screens

Open `<FrontendUrl>` on each device. It asks once for the **family id**
and **API key** from step 3, keeps them in that device's `localStorage`,
and sends the key only as an `Authorization` header.

- **Echo Show** — open it in Silk, then add it to the home screen
- **Phones** — open it, then **Add to Home Screen**; the web manifest makes
  it open without browser chrome

Every screen re-reads the family's data every 30 seconds and whenever it
becomes visible, so an edit on a phone shows up in the kitchen without
anyone reloading.

To un-link a device later (selling a tablet, say), clear its site data.

---

## 6. First-run setup, in the app

Roughly ten minutes, and it's what makes everything afterwards work:

1. **Add your chores.** The chore library offers common ones grouped by
   part of the day — tap to add, set who and what it pays.
2. **Set up the morning.** *The morning → Set up the school morning.* It
   drafts the steps from the morning chores you just added; correct the
   times and set the bus time. Do bedtime too if you want it.
3. **Set a prize for each child** so the gems mean something.
4. **Plan a few dinners.** The grocery list builds itself from the
   ingredients you type in.

Then leave it alone for a fortnight. Every "usually 15 min" and "100% of
your 60-minute blocks" in this app is computed from *your* records — until
those exist it shows your own estimates and says so.

---

## 7. The Alexa skill (optional)

```bash
cd ../alexa-skill
npm install --prefix lambda
npm run build --prefix lambda
ask deploy
```

Set these on the skill's Lambda function:

| Variable | Value |
|---|---|
| `YOUENJOYMYFAMILY_API_BASE_URL` | the `ApiUrl` from step 2 |
| `YOUENJOYMYFAMILY_FAMILY_ID` | the `familyId` from step 3 |
| `YOUENJOYMYFAMILY_FAMILY_API_KEY` | the `apiKey` from step 3 |
| `YOUENJOYMYFAMILY_TIME_ZONE` | e.g. `America/New_York` |

The timezone matters more than it looks. Lambda runs in UTC, so without
it an evening "what's for dinner?" answers with *tomorrow's* meal for any
family west of UTC.

---

## Later deploys

```bash
cd backend  && npm run verify:template && npm run build && sam deploy
cd frontend && VITE_API_BASE_URL="<ApiUrl>" npm run build && \
  aws s3 sync dist/ s3://<FrontendBucketName>/ --delete && \
  aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"
```

---

## What it costs

Genuinely small for one household. DynamoDB is on-demand, Lambda and API
Gateway are per-request, and a family generates a few thousand requests a
month. The parts that cost money whether or not anyone opens the app:

- **CloudFront + S3** — pennies at this traffic
- **DynamoDB point-in-time recovery** — on, deliberately: it's the
  difference between a bad afternoon and losing the children's gem history
- **X-Ray tracing** — on (`Tracing: Active`); turn it off in `template.yaml`
  under `Globals.Function` once you're happy it works

Expect low single-digit dollars a month. Set a billing alarm anyway.

---

## When something goes wrong

| What you see | What it is |
|---|---|
| Deploy rolls back mentioning `resolve:ssm` | A parameter from step 1 doesn't exist in that region |
| Every request 401s | The key is wrong, or the screen was linked to a different family |
| Screen shows the setup prompt again | The key was rejected — it's been rotated, or the stack was rebuilt |
| `AccessDenied` in a Lambda log | A handler lost its DynamoDB policy; `npm run verify:template` names it |
| The app loads but is stuck "Loading your family's day" | `VITE_API_BASE_URL` was wrong at build time — it's baked in, so rebuild |
| Old version keeps loading | The CloudFront invalidation hasn't finished, or `index.html` was cached |

Logs:

```bash
sam logs --stack-name youenjoymyfamily --tail
sam logs --stack-name youenjoymyfamily -n RoutinesFunction --tail
```

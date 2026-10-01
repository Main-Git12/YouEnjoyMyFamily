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
| **Google OAuth client** | *not yet worth getting* — see below |

**Google Calendar sync does not work yet, and setting up a Google client
will not make it work.** The sync job is written and tested and runs every
fifteen minutes; what does not exist is the OAuth consent flow that would
store a family's token in the first place. Nothing writes one, so the job
finds no families, does nothing, and reports success. It is listed in
step 1 because the template still resolves the parameters, not because
connecting a calendar is possible today. Put a placeholder in and move on.

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

# Placeholders are fine: calendar sync can't be connected yet (step 0).
# The stack needs these to exist, not to be valid.
aws ssm put-parameter --name /youenjoymyfamily/google/client-id \
  --type String --value "<your client id>"
aws ssm put-parameter --name /youenjoymyfamily/google/client-secret \
  --type SecureString --value "<your client secret>"
```

**Don't have them yet?** Put a placeholder in each rather than skipping
them — the deploy needs the parameter to *exist*, not to be valid.
Chores, routines, gems, focus blocks, meal planning, the grocery list,
the school sheet and the weather all work without either integration.
You'll get an error only if you press "checkout".

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

**Phones and tablets** — open it, then **Add to Home Screen**. The web
manifest makes it open without browser chrome, like an app.

**Echo Show** — this one is worth setting expectations about, because the
device is more closed than it looks:

1. Say **"Alexa, open Silk"**. The Echo Show runs Amazon's Silk browser
   and there is no way to install a third-party app on it.
2. Go to `<FrontendUrl>`, link the screen, then tap the **save page**
   icon next to the address bar to bookmark it.
3. After that, **"Alexa, open Silk"** and pick the bookmark.

There is **no way to put a shortcut on the Echo Show's home screen** —
Amazon doesn't offer one, and the bookmark is the nearest thing. Silk
also **closes itself after a spell of inactivity**, and Amazon provides
no setting to stop it; the screen goes back to Alexa's own home view and
somebody has to say "Alexa, open Silk" again.

The app has a **Keep screen on** button for the stretch while it is open,
which uses the browser's wake-lock. Tap it once after opening the
bookmark. Two honest caveats: the browser only grants a wake lock over
HTTPS (so it will do nothing against a plain-HTTP address), and it has
not been tried on a real Echo Show — it is built against the standard
API, and how much of it Silk honours is not something this repo can
claim from here.

If you want the Echo Show to be able to *answer* rather than only
display — "what's on at school", "what's left on the list" — that is
what the Alexa skill in step 7 is for, and on that device it is the more
reliable of the two.

**There is a second route, and it is better — read step 7a before
settling for the bookmark.** The skill can put this exact app on the
screen by voice, with no browser and no bookmark at all.

Every screen re-reads the family's data every 30 seconds and whenever it
becomes visible, so an edit on a phone shows up in the kitchen without
anyone reloading.

To un-link one device (selling a tablet, say), clear its site data. To cut
off a key that has got out — it lives in the browser storage of a screen
on a kitchen wall — use **Setup → This family's key → Replace the family
key**. That signs out *every* device in the house, including the ones not
in the room, and each has to be linked again with the new key.

---

## 6. First-run setup, in the app

Roughly ten minutes, and it's what makes everything afterwards work:

1. **Add your chores.** The chore library offers common ones grouped by
   part of the day — tap to add, set who and what it pays.
2. **Set up the morning.** *The morning → Set up the school morning.* It
   drafts the steps from the morning chores you just added; correct the
   times and set the bus time. Do bedtime too if you want it.
3. **Say where the house is.** *Setup → Where you are.* Searched by town
   name, never a coordinate, and stored rounded to about a kilometre. It
   buys one line: what the weather will be doing at the moment you have to
   be out of the door. Skip it and everything else still works.
4. **Type in the school sheet.** *Setup → The specials sheet.* The
   rotation matters less than the small print under two or three of the
   days — gym shoes, a charged laptop, the library book that goes back.
   Type those in the school's own words, so you recognise the sentence.
   That is what the evening panel and the Alexa question both read.
5. **Set a prize for each child** so the gems mean something.
6. **Plan a few dinners.** The grocery list builds itself from the
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
family west of UTC — and "what's on at school" answers about the wrong
day, since it switches from today to tomorrow at five in the evening.

Things worth asking it, once the sheet from step 6 is in:

- *"Alexa, ask you enjoy my family what's on at school"* — the special,
  what the school said to bring, whether it's been ticked off, and
  what's for lunch. Before five it means today; after five it means the
  bag that has to be packed tonight.
- *"...what's left on the list"*, *"...what's for dinner"*,
  *"...how close is Parker to his prize"*.

On an Echo Show this is the more reliable half of the two: the skill
answers on a device where the browser closes itself and cannot be
pinned to the home screen.

---

## 7a. The family screen, opened by voice (optional, read the caveat)

Amazon has an interface — `Alexa.Presentation.HTML` — that lets a skill
hand the device a URL and have the device run it full-screen inside the
skill session. With it, **"Alexa, open You Enjoy My Family"** puts this
app on the kitchen wall. No Silk, no bookmark, no four-tap ritual.

### The caveat, first

Amazon's own documentation says this, verbatim:

> Your HTML app must be a game. Other types of apps can't use the Alexa
> Web API for Games.

That is a flat statement about app type, not only a certification note.
In practice:

- **On your own Echo Show it will almost certainly work.** Amazon's
  documented requirements for using the interface are exactly two —
  declare `ALEXA_PRESENTATION_HTML` in the manifest, and host the app on
  HTTPS with a valid certificate. Publication status, skill stage and
  certification are never mentioned as gates, and the docs assume you run
  the thing on a real device while developing it. Nothing checks at
  runtime whether a web app is a game. But Amazon does not state in
  writing that a development-stage skill may use it, so this is inference
  from what the documentation requires, not a promise it makes.
- **It would fail certification** if you ever submitted the skill to the
  public skill store. You have no reason to — this is one household.
- **Amazon could change it.** You are using the interface outside its
  stated purpose, so treat it as a convenience that might stop working,
  not as the foundation. The Silk route in step 5 still works and is the
  fallback.

Decide that for yourself. The feature is **off until you set a URL**, so
nothing here is enabled by accident.

### Turning it on

Set these on the skill's Lambda, alongside the variables in step 7:

| Variable | Value |
|---|---|
| `YOUENJOYMYFAMILY_WEB_APP_URL` | the same `<FrontendUrl>` from step 4 |
| `YOUENJOYMYFAMILY_WEB_APP_AUTOLINK` | `true` to hand the screen its key automatically (see below) |

Then redeploy the skill (`ask deploy`) — the manifest change that
declares the interface ships with it.

### About `AUTOLINK`

The Alexa runtime **disables browser local storage** and wipes cookies at
the end of every skill session. There is no persistence on the device at
all, which means the usual "type the key once and it remembers" does not
work there — the screen would ask again every single time.

With `YOUENJOYMYFAMILY_WEB_APP_AUTOLINK=true` the skill passes the family
id *and* the API key to the page at launch, and the screen is ready to
use immediately. Without it, only the family id is passed and the screen
still asks for the key — every session, which in practice means the
feature is not usable.

So the honest trade: **leave it off and this is a demo; turn it on and
it is a wall display.** Turning it on means the key travels from the
Lambda through Amazon's service to the device, which is one hop more than
a person typing it into that same device. It is your key and your
household — but it is a credential, so the app will not send it unless
you say so, and `true` is the only value that counts.

If the key ever needs cutting off, that is Setup → This family's key on
any linked screen (step 5).

### What to expect on the device

- **It times out.** Amazon caps the no-interaction lifetime at five
  minutes, and the skill asks for the maximum. The screen then goes back
  to Alexa's home view and somebody says "Alexa, open You Enjoy My
  Family" again. This is **not** an always-on display — nothing available
  on an Echo Show is.
- **Asking the skill a question while the screen is up is fine.** It
  answers out loud and leaves the screen alone. (Any non-HTML directive
  would close the web app, so the skill deliberately stops drawing its
  APL cards while the app is on screen.)
- **"Alexa, exit" or "Alexa, go home" closes it**, as does the skill
  ending the session.
- Everything must be HTTPS with a valid certificate — the page, and
  every image, font and API call it makes. Mixed content simply fails.

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
| Screen shows the setup prompt again | The key was rejected — someone replaced it (Setup → This family's key), or the stack was rebuilt |
| `AccessDenied` in a Lambda log | A handler lost its DynamoDB policy; `npm run verify:template` names it |
| The app loads but is stuck "Loading your family's day" | `VITE_API_BASE_URL` was wrong at build time — it's baked in, so rebuild |
| Old version keeps loading | The CloudFront invalidation hasn't finished, or `index.html` was cached |
| The Echo Show has gone back to Alexa's home view | Silk closed itself after a spell of idle. Say "Alexa, open Silk" and pick the bookmark; Amazon offers no setting to stop this. On the voice route (step 7a) the cap is five minutes and the fix is to say the invocation name again |
| "Alexa, open You Enjoy My Family" talks but shows nothing | `YOUENJOYMYFAMILY_WEB_APP_URL` isn't set on the skill's Lambda, or the device isn't an Echo Show |
| The voice-opened screen keeps asking for the family key | `YOUENJOYMYFAMILY_WEB_APP_AUTOLINK` isn't `true`. Alexa's runtime has no storage, so without it the screen cannot remember anything between sessions |
| "I couldn't reach the family screen" | The skill got an HTTP error loading `YOUENJOYMYFAMILY_WEB_APP_URL` — wrong address, or the certificate isn't valid |
| "Keep screen on" does nothing | The browser only grants a wake lock over HTTPS, and how much of it Silk honours is untested on a real device |
| The morning plan says "your estimate" everywhere | Normal for the first fortnight — every learned duration comes from your own finished runs, and it says so rather than guessing |
| Nothing appears from Google Calendar | Expected: the sync runs but there is no way to connect a calendar yet (step 0) |
| A 429 from the API | Something is calling `POST /families` in a loop — that route is throttled to 1/second on purpose |

Logs:

```bash
sam logs --stack-name youenjoymyfamily --tail
sam logs --stack-name youenjoymyfamily -n RoutinesFunction --tail
```

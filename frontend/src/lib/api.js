const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${path}`);
  }

  return response.json();
}

export const api = {
  listTasks: (familyId) => request(`/families/${familyId}/tasks`),
  createTask: (familyId, task) =>
    request(`/families/${familyId}/tasks`, { method: "POST", body: JSON.stringify(task) }),
  listSchedules: (familyId, start, end) =>
    request(`/families/${familyId}/schedules?start=${start ?? ""}&end=${end ?? ""}`),
  listCartItems: (familyId) => request(`/families/${familyId}/grocery-cart`),
};

const loginForm = document.querySelector("#loginForm");
const usernameField = document.querySelector("#usernameField");
const passwordField = document.querySelector("#passwordField");
const submitBtn = document.querySelector("#submitBtn");
const errorText = document.querySelector("#errorText");

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || data?.message || "请求失败");
  }

  return data;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorText.textContent = "";
  submitBtn.disabled = true;

  try {
    await request("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: usernameField.value.trim(),
        password: passwordField.value
      })
    });
    window.location.href = "/";
  } catch (error) {
    errorText.textContent = error.message;
  } finally {
    submitBtn.disabled = false;
  }
});

export function applyTheme(theme) {
    const html = document.documentElement;
    const body = document.body;
  
    html.classList.remove("light", "dark");
    body.classList.remove("light", "dark");
  
    if (theme === "light") {
      html.classList.add("light");
      body.classList.add("light");
    } else if (theme === "dark") {
      html.classList.add("dark");
      body.classList.add("dark");
    }
    // system → no class, CSS media query applies
  }
  
  export function getStoredTheme() {
    if (typeof window === "undefined") return "system";
    return localStorage.getItem("theme") || "system";
  }
  
  export function setStoredTheme(theme) {
    localStorage.setItem("theme", theme);
  }
  
// Bootstrap script — kept in a separate file (not inline) so CSP can stay strict.
if (window.location.hash === "#admin") {
  document.querySelector('link[rel="manifest"]').href = "/manifest-admin.json";
  document.title = "StreetTaco Admin";
  document.querySelector('meta[name="theme-color"]').content = "#f59e0b";
}
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "sw_updated") {
        if (confirm("A new version of StreetTaco is available. Reload now?")) {
          window.location.reload();
        }
      }
    });
  });
}

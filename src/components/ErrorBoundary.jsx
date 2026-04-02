import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "'Inter', sans-serif", color: "#94a3b8", textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: "3rem", marginBottom: 16 }}>🌮</div>
          <h2 style={{ color: "#f1f5f9", margin: "0 0 8px" }}>Something went wrong</h2>
          <p style={{ margin: "0 0 20px", maxWidth: 360 }}>StreetTaco hit an unexpected error. Try refreshing the page.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: "#06b6d4", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: "1rem", cursor: "pointer", fontWeight: 600 }}
          >
            Refresh
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

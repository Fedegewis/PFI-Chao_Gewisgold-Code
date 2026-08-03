import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="panel" style={{ margin: "2rem", textAlign: "center", padding: "2rem" }}>
          <p style={{ marginBottom: "1rem" }}>Algo salió mal. Podés reintentar o recargar la página.</p>
          <button
            className="primary"
            onClick={() => this.setState({ hasError: false })}
            style={{ marginRight: "0.5rem" }}
          >
            Reintentar
          </button>
          <button className="secondary-action" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

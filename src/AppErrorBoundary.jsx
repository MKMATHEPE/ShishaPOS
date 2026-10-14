import { Component } from 'react';
import { recordDiagnostic, downloadDiagnostics } from './monitoring';
export default class AppErrorBoundary extends Component {
  state={failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  componentDidCatch() { recordDiagnostic('error','react_error'); }
  render() {
    if(!this.state.failed) return this.props.children;
    return <div role="alert" className="app-error"><h1>Something went wrong</h1><p>Reload to reopen the POS. Sales already queued offline remain on this device.</p><button onClick={()=>window.location.reload()}>Reload POS</button><button onClick={downloadDiagnostics}>Download diagnostic report</button></div>;
  }
}

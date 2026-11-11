import { Component } from 'react'

/**
 * Last-resort render guard: a view exception degrades to a recovery
 * panel instead of a blank screen. The network, request form and any
 * captured order state stay intact in React Router-free land — reload
 * re-enters at the request view.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto w-full max-w-lg px-6 py-20">
        <div className="panel p-7">
          <p className="kicker">System fault</p>
          <h1 className="mt-3 font-display text-[26px] font-medium tracking-[-0.01em] text-ink">
            Rendering error
          </h1>
          <p className="mt-2 break-words text-sm leading-relaxed text-secondary">
            {String(this.state.error?.message ?? this.state.error)}
          </p>
          <button type="button" className="btn btn-primary mt-7" onClick={() => window.location.reload()}>
            Reload interface
          </button>
        </div>
      </div>
    )
  }
}

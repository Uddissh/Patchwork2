import { useCallback, useEffect, useRef, useState } from 'react'
import Header from './components/Header.jsx'
import RequestView from './components/RequestView.jsx'
import NetworkView from './components/NetworkView.jsx'
import CheckoutView from './components/CheckoutView.jsx'
import SuccessView from './components/SuccessView.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Toast from './components/Toast.jsx'
import { Icon } from './components/Icons.jsx'
import PageTransitionWrapper from './components/PageTransitionWrapper.jsx'
import { api, API_BASE } from './api.js'
import { describeError, normalizeCapture, ORDER_CACHE_KEY } from './lib/normalize.js'
import { selectedSuppliers } from './lib/selection.js'

const EMPTY_FORM = { description: '', budget: '', deadline: '', quantity: '' }

export default function App() {
  const [view, setView] = useState('request')
  const [form, setForm] = useState(EMPTY_FORM)
  const [stages, setStages] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [assemblyRaw, setAssemblyRaw] = useState(null) // LLM narration from /assemble
  const [order, setOrder] = useState(null)
  const [capturing, setCapturing] = useState(null) // order id while capture is in flight
  const [toast, setToast] = useState(null)
  // PayPal redirects back with ?order_id=… — capture exactly once, even
  // under StrictMode double-invocation. Keyed by order id so a genuinely
  // new return (fresh page load) always captures.
  const capturedRef = useRef(null)

  const showToast = useCallback((type, message, detail = null) => {
    setToast({ id: Date.now() + Math.random(), type, message, detail })
  }, [])

  const handleAssembled = useCallback(({ stages: st, suppliers: sup, raw }) => {
    setToast(null)
    setStages(st)
    setSuppliers(sup)
    setAssemblyRaw(raw ?? null)
    setView('network')
  }, [])

  const navigate = useCallback((target) => {
    setToast(null)
    setView(target)
  }, [])

  // Return leg of the PayPal flow: ?order_id=… → POST /checkout/capture → success screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const orderId = params.get('order_id') || params.get('orderID') || params.get('token')
    if (!orderId || capturedRef.current === orderId) return
    capturedRef.current = orderId

    let saved = null
    try {
      saved = JSON.parse(sessionStorage.getItem(ORDER_CACHE_KEY) || 'null')
    } catch {
      /* ignore corrupt cache */
    }
    if (saved?.suppliers?.length) {
      setSuppliers(saved.suppliers)
      setStages(saved.stages ?? [])
      if (saved.form) setForm(saved.form)
    }

    setCapturing(orderId)
    ;(async () => {
      try {
        const res = await api.capture({
          order_id: orderId,
          orderID: orderId,
          payer_id: params.get('PayerID') || params.get('payer_id') || null,
        })
        const info = normalizeCapture(res)
        setOrder({
          orderId,
          id: info.id,
          status: info.status,
          // Capture returns one settled payment per purchase unit — the raw
          // material for the payment-split visualization on the success page.
          payments: Array.isArray(res?.payments) ? res.payments : [],
          // The captured amount follows the shared selection definition —
          // the same set the Network screen highlighted and Checkout charged.
          total: selectedSuppliers(saved?.suppliers ?? []).reduce(
            (a, s) => a + (Number.isFinite(s.price) ? s.price : 0),
            0,
          ) || null,
        })
        setView('success')
        try {
          sessionStorage.removeItem(ORDER_CACHE_KEY)
        } catch {
          /* ignore */
        }
      } catch (err) {
        showToast('error', `Payment capture failed — ${describeError(err)}`)
        setView(saved?.suppliers?.length ? 'checkout' : 'request')
      } finally {
        setCapturing(null)
        window.history.replaceState({}, '', window.location.pathname + window.location.hash)
      }
    })()
  }, [showToast])

  const restart = useCallback(() => {
    setOrder(null)
    setSuppliers([])
    setStages([])
    setAssemblyRaw(null)
    setForm(EMPTY_FORM)
    setToast(null)
    setView('request')
    try {
      sessionStorage.removeItem(ORDER_CACHE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const hasNetwork = suppliers.length > 0
  let v = view
  if (!hasNetwork && (view === 'network' || view === 'checkout')) v = 'request'
  const step = { request: 1, network: 2, checkout: 3, success: 4 }[v] ?? 1
  const canGoTo = (n) => n === 1 || (hasNetwork && n <= 3 && !order)
  const go = (target) => {
    if ((target === 'network' || target === 'checkout') && !hasNetwork) return
    setView(target)
  }

  // Toasts are dismissed at the navigation entry points (go/onProceed/
  // onBack/restart) so a fresh failure toast always survives its switch.
  // Scroll reset and the exit/enter choreography live in PageTransitionWrapper.

  return (
    <div className="relative flex min-h-screen flex-col bg-limestone font-sans text-ink">
      <Header step={step} canGoTo={canGoTo} onGo={go} />

      <main className="flex-1">
        <ErrorBoundary>
          <PageTransitionWrapper
            viewKey={v}
            views={{
              request: (
                <RequestView form={form} setForm={setForm} onAssembled={handleAssembled} showToast={showToast} />
              ),
              network: (
                <NetworkView
                  stages={stages}
                  suppliers={suppliers}
                  setSuppliers={setSuppliers}
                  form={form}
                  assemblyRaw={assemblyRaw}
                  onProceed={() => navigate('checkout')}
                  showToast={showToast}
                />
              ),
              checkout: (
                <CheckoutView
                  stages={stages}
                  suppliers={suppliers}
                  form={form}
                  onBack={() => navigate('network')}
                  showToast={showToast}
                />
              ),
              success: <SuccessView order={order ?? {}} suppliers={suppliers} onRestart={restart} />,
            }}
          />
        </ErrorBoundary>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-6 py-4 lg:px-10">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
            PATCHWORK — AI-assembled supplier networks
          </span>
          <span className="metric text-[10px] text-faint">{API_BASE}</span>
        </div>
      </footer>

      <Toast toast={toast} onClose={() => setToast(null)} />

      {capturing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-limestone/85">
          <div className="panel flex items-center gap-4 px-8 py-6">
            <Icon name="spinner" className="h-5 w-5 animate-spin text-forest" />
            <div>
              <p className="font-semibold text-ink">Capturing payment…</p>
              <p className="mt-0.5 metric text-xs text-secondary">order {capturing}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

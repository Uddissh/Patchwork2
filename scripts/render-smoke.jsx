/**
 * PATCHWORK — render smoke test (dev harness, not part of the app bundle).
 *
 * Executes every view's real render path via react-dom/server with fixture
 * data, so render-time ReferenceErrors (like an un-imported helper) surface
 * without a browser. Bundle with esbuild, then run with node:
 *
 *   node_modules/.bin/esbuild scripts/render-smoke.jsx --bundle \
 *     --format=esm --platform=node --jsx=automatic --loader:.css=empty \
 *     --banner:js="if(!import.meta.env) import.meta.env = {}" \
 *     --outfile=scripts/.render-smoke.bundle.mjs
 *   node scripts/.render-smoke.bundle.mjs
 */
import { renderToString } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import RequestView from '../src/components/RequestView.jsx'
import NetworkView from '../src/components/NetworkView.jsx'
import CheckoutView from '../src/components/CheckoutView.jsx'
import SuccessView from '../src/components/SuccessView.jsx'
import SupplierNode from '../src/components/flow/SupplierNode.jsx'
import AnimatedEdge from '../src/components/flow/AnimatedEdge.jsx'
import LaneNode from '../src/components/flow/LaneNode.jsx'
import Header from '../src/components/Header.jsx'
import Toast from '../src/components/Toast.jsx'
import App from '../src/App.jsx'

const stages = ['Design', 'Manufacturing', 'Printing', 'Packaging', 'Delivery']

const mk = (key, stageIndex, slot, price, days, name, category, status = 'idle') => ({
  key,
  id: key,
  name,
  category,
  stageIndex,
  slot,
  price,
  days,
  status,
  raw: { id: key, name, category, price, days },
})

const suppliers = [
  mk('n0-sup-01', 0, 0, 480, 6, 'Atelier Nord Studio', 'Design'),
  mk('n1-sup-02', 0, 1, 520, 5, 'Form & Field Co.', 'Design'),
  mk('n2-sup-03', 1, 0, 2840, 12, 'Kilnworks Birmingham', 'Manufacturing'),
  mk('n3-sup-04', 1, 1, 2610, 14, 'TerraCotta Union', 'Manufacturing'),
  mk('n4-sup-05', 2, 0, 1150, 7, 'Pressroom 44', 'Printing'),
  mk('n5-sup-06', 2, 1, 980, 9, 'Two Tone Press', 'Printing'),
  mk('n6-sup-07', 3, 0, 640, 4, 'Boxwell Fabricators', 'Packaging'),
  mk('n7-sup-08', 3, 1, 590, 5, 'Cartonnage International', 'Packaging'),
  mk('n8-sup-09', 4, 0, 830, 3, 'Meridian Freight', 'Delivery'),
]

const repaired = suppliers.map((s) =>
  s.key === 'n2-sup-03'
    ? { ...s, name: 'Cerro Verde Pottery', price: 2450, days: 11, status: 'repaired', key: 'n2-sup-03-fx-1' }
    : s,
)

const form = { description: '500 mugs', budget: '10000', deadline: '30', quantity: '500' }
const noop = () => {}

const cases = {
  'App (Request mounted)': <App />,
  Header: <Header step={2} canGoTo={() => true} onGo={noop} />,
  RequestView: <RequestView form={form} setForm={noop} onAssembled={noop} showToast={noop} />,
  NetworkView: (
    <NetworkView
      stages={stages}
      suppliers={suppliers}
      setSuppliers={noop}
      form={form}
      onProceed={noop}
      showToast={noop}
    />
  ),
  'NetworkView (post-repair)': (
    <NetworkView
      stages={stages}
      suppliers={repaired}
      setSuppliers={noop}
      form={form}
      onProceed={noop}
      showToast={noop}
    />
  ),
  CheckoutView: (
    <CheckoutView stages={stages} suppliers={suppliers} form={form} onBack={noop} showToast={noop} />
  ),
  SuccessView: (
    <SuccessView order={{ orderId: 'MOCK-1', status: 'COMPLETED', total: 5640 }} suppliers={suppliers} onRestart={noop} />
  ),
  SupplierNode: (
    <ReactFlowProvider>
      <SupplierNode
        data={{
          supplier: suppliers[2],
          stageName: 'Manufacturing',
          selected: true,
          why: 'Fastest in stage',
          appearDelay: 0,
        }}
      />
    </ReactFlowProvider>
  ),
  AnimatedEdge: (
    <AnimatedEdge
      id="a=>b"
      sourceX={0}
      sourceY={0}
      targetX={340}
      targetY={100}
      sourcePosition="right"
      targetPosition="left"
      markerEnd=""
      data={{ state: 'nominal', chain: true, drawDelay: 0 }}
    />
  ),
  LaneNode: <LaneNode data={{ index: 0, name: 'Design', count: 2, height: 300 }} />,
  Toast: <Toast toast={{ id: 1, type: 'error', message: 'test' }} onClose={noop} />,
}

let failures = 0
const rendered = {}
for (const [name, el] of Object.entries(cases)) {
  try {
    const html = renderToString(el)
    if (!html || html.length < 20) throw new Error('rendered empty output')
    rendered[name] = html
    console.log(`OK      ${name} (${html.length} chars)`)
  } catch (err) {
    failures++
    console.log(`THREW   ${name}: ${err.message}`)
  }
}

// Regression assertions — the aria-label calls money() at render time; this
// is the exact expression that threw "Can't find variable: money".
const nw = rendered['NetworkView'] ?? ''
if (!nw.includes('cost $2,840.00')) {
  failures++
  console.log('ASSERT  NetworkView aria-label missing money() output (cost $2,840.00)')
} else {
  console.log('ASSERT  NetworkView aria-label money() output present')
}
const sn = rendered['SupplierNode'] ?? ''
if (!sn.includes('$2,840.00')) {
  failures++
  console.log('ASSERT  SupplierNode missing money() output')
} else {
  console.log('ASSERT  SupplierNode money() output present')
}
const co = rendered['CheckoutView'] ?? ''
if (!co.includes('$2,840.00')) {
  failures++
  console.log('ASSERT  CheckoutView missing ledger money() output ($2,840.00 row)')
} else {
  console.log('ASSERT  CheckoutView ledger money() output present')
}

console.log(failures === 0 ? 'ALL RENDERS PASS' : `${failures} RENDER FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)

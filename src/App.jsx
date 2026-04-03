import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BrowserRouter,
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { ApiError, api, createChatSocket, getToken, setToken } from './api'
import {
  firstIssueMessage,
  validateCheckoutForm,
  validateProductForm,
  validateSignInForm,
  validateSignUpForm,
} from './validators'

const UI_STATE_KEY = 'sameria-ui-state-v1'

const fallbackProducts = [
  {
    id: 'sam-001',
    name: 'Emerald Tailored Blazer',
    price: 5400,
    category: 'Outerwear',
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Deep Green', 'Sand'],
    image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=80',
    description: 'Premium structured blazer with breathable lining for Dhaka to destination styling.',
    rating: 4.8,
    reviews: 112,
    featured: true,
    trending: true,
    stock: 24,
  },
  {
    id: 'sam-002',
    name: 'Monsoon Linen Shirt',
    price: 2100,
    category: 'Shirts',
    sizes: ['S', 'M', 'L'],
    colors: ['Ivory', 'Deep Green'],
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80',
    description: 'Soft woven linen shirt engineered for humid climates and elegant layering.',
    rating: 4.6,
    reviews: 84,
    featured: true,
    trending: false,
    stock: 40,
  },
  {
    id: 'sam-003',
    name: 'Sameria Signature Panjabi',
    price: 3200,
    category: 'Ethnic',
    sizes: ['M', 'L', 'XL'],
    colors: ['Deep Green', 'Charcoal'],
    image: 'https://images.unsplash.com/photo-1617137968427-85924c800a22?auto=format&fit=crop&w=900&q=80',
    description: 'Modern panjabi silhouette with hand-finished collar detailing.',
    rating: 4.9,
    reviews: 55,
    featured: true,
    trending: true,
    stock: 18,
  },
  {
    id: 'sam-004',
    name: 'Urban Cargo Trousers',
    price: 2800,
    category: 'Bottoms',
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Olive', 'Black'],
    image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=80',
    description: 'Relaxed fit cargo with premium twill and utility pocket layout.',
    rating: 4.5,
    reviews: 48,
    featured: false,
    trending: true,
    stock: 35,
  },
  {
    id: 'sam-005',
    name: 'Silk Drape Maxi Dress',
    price: 4500,
    category: 'Dresses',
    sizes: ['S', 'M', 'L'],
    colors: ['Forest', 'Sand'],
    image: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80',
    description: 'Fluid silhouette with elegant drape designed for premium occasions.',
    rating: 4.7,
    reviews: 91,
    featured: false,
    trending: true,
    stock: 26,
  },
]

const fallbackCoupons = [
  { code: 'WELCOME10', type: 'percent', value: 10, active: true },
  { code: 'SAMERIA500', type: 'fixed', value: 500, active: true },
]

const initialState = {
  products: fallbackProducts,
  users: [],
  currentUser: null,
  cart: [],
  wishlist: [],
  orders: [],
  globalDiscount: { enabled: false, type: 'percent', value: 0 },
  productDiscounts: {},
  coupons: fallbackCoupons,
  activeCoupon: null,
  chatMessages: [],
  auditEntries: [],
  notifications: [],
  loading: true,
}

const currency = (n) => `৳${Number(n).toLocaleString('en-BD')}`

const inventoryStatus = (stock) => {
  if (stock <= 0) {
    return 'Out of Stock'
  }
  if (stock <= 10) {
    return 'Low Stock'
  }
  return 'In Stock'
}

function formatApiErrorMessage(error, fallback = 'Something went wrong') {
  if (error instanceof ApiError) {
    if (error.issues?.length) {
      return error.issues.map((i) => `${i.path || 'field'}: ${i.message}`).join(' | ')
    }
    return error.message || fallback
  }
  return error?.message || fallback
}

function mergeById(items) {
  return Object.values(
    items.reduce((acc, item) => {
      acc[item.id] = item
      return acc
    }, {})
  ).sort((a, b) => a.createdAt - b.createdAt)
}

function productPrice(state, product) {
  const pDiscount = state.productDiscounts[product.id]
  const discount = pDiscount?.enabled ? pDiscount : state.globalDiscount.enabled ? state.globalDiscount : null
  if (!discount) {
    return product.price
  }
  if (discount.type === 'percent') {
    return Math.max(0, Math.round(product.price * (1 - discount.value / 100)))
  }
  return Math.max(0, product.price - discount.value)
}

function computeCartTotals(state) {
  const items = state.cart
    .map((entry) => {
      const product = state.products.find((p) => p.id === entry.productId)
      if (!product) {
        return null
      }
      const unit = productPrice(state, product)
      return { ...entry, product, unit, line: unit * entry.quantity }
    })
    .filter(Boolean)

  const subtotal = items.reduce((sum, it) => sum + it.line, 0)
  let couponDiscount = 0
  if (state.activeCoupon) {
    couponDiscount = state.activeCoupon.type === 'percent'
      ? Math.round(subtotal * (state.activeCoupon.value / 100))
      : state.activeCoupon.value
  }
  couponDiscount = Math.min(couponDiscount, subtotal)
  const shipping = subtotal > 5000 || subtotal === 0 ? 0 : 120
  const total = subtotal - couponDiscount + shipping
  return { items, subtotal, couponDiscount, shipping, total }
}

function loadUiState() {
  const raw = localStorage.getItem(UI_STATE_KEY)
  if (!raw) {
    return { cart: [], wishlist: [] }
  }
  try {
    const parsed = JSON.parse(raw)
    return { cart: parsed.cart || [], wishlist: parsed.wishlist || [] }
  } catch {
    return { cart: [], wishlist: [] }
  }
}

function useAppStore() {
  const ui = loadUiState()
  const [state, setState] = useState({ ...initialState, cart: ui.cart, wishlist: ui.wishlist })
  const [authToken, setAuthToken] = useState(() => getToken())
  const socketRef = useRef(null)

  const pushNotification = (text, type = 'info') => {
    setState((prev) => ({
      ...prev,
      notifications: [{ id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, type, createdAt: Date.now() }, ...prev.notifications],
    }))
  }

  useEffect(() => {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({ cart: state.cart, wishlist: state.wishlist }))
  }, [state.cart, state.wishlist])

  useEffect(() => {
    const socket = createChatSocket()
    socketRef.current = socket
    socket.on('chat:new', (message) => {
      setState((prev) => ({ ...prev, chatMessages: mergeById([...prev.chatMessages, message]) }))
    })
    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    async function bootstrap() {
      try {
        const data = await api('/api/bootstrap', { token: authToken || undefined })
        setState((prev) => ({
          ...prev,
          ...data,
          cart: prev.cart,
          wishlist: prev.wishlist,
          activeCoupon: prev.activeCoupon,
          notifications: prev.notifications,
          loading: false,
        }))
      } catch {
        setState((prev) => ({
          ...prev,
          products: prev.products.length ? prev.products : fallbackProducts,
          coupons: prev.coupons.length ? prev.coupons : fallbackCoupons,
          loading: false,
        }))
        pushNotification('Backend is offline. Showing sample products.', 'info')
      }
    }
    bootstrap()
  }, [authToken])

  const actions = {
    signup: async (payload) => {
      const data = await api('/api/auth/signup', { method: 'POST', body: payload })
      setToken(data.token)
      setAuthToken(data.token)
      setState((prev) => ({ ...prev, currentUser: data.user }))
      pushNotification(`Welcome to SAMERIA, ${data.user.name}!`, 'success')
      return true
    },
    signin: async ({ email, password }) => {
      const data = await api('/api/auth/signin', { method: 'POST', body: { email, password } })
      setToken(data.token)
      setAuthToken(data.token)
      setState((prev) => ({ ...prev, currentUser: data.user }))
      pushNotification(`Welcome back, ${data.user.name}.`, 'success')
      return data.user
    },
    signout: () => {
      setToken('')
      setAuthToken('')
      setState((prev) => ({ ...prev, currentUser: null, activeCoupon: null, orders: [], users: [] }))
      pushNotification('You are signed out.', 'info')
    },
    toggleWishlist: (productId) => {
      setState((prev) => {
        const exists = prev.wishlist.includes(productId)
        return { ...prev, wishlist: exists ? prev.wishlist.filter((id) => id !== productId) : [...prev.wishlist, productId] }
      })
    },
    addToCart: (productId, size) => {
      setState((prev) => {
        const idx = prev.cart.findIndex((c) => c.productId === productId && c.size === size)
        if (idx >= 0) {
          const copy = [...prev.cart]
          copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 }
          return { ...prev, cart: copy }
        }
        return { ...prev, cart: [...prev.cart, { id: `c-${Date.now()}`, productId, size, quantity: 1 }] }
      })
    },
    updateCartQty: (id, quantity) => {
      setState((prev) => ({
        ...prev,
        cart: prev.cart
          .map((item) => (item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item))
          .filter((item) => item.quantity > 0),
      }))
    },
    removeCartItem: (id) => setState((prev) => ({ ...prev, cart: prev.cart.filter((it) => it.id !== id) })),
    applyCoupon: async (code) => {
      const data = await api('/api/coupons/apply', { method: 'POST', body: { code } })
      setState((prev) => ({ ...prev, activeCoupon: data.coupon }))
      pushNotification(`Coupon ${data.coupon.code} applied.`, 'success')
      return true
    },
    placeOrder: async (checkout) => {
      if (!state.currentUser) {
        return null
      }
      const data = await api('/api/orders', {
        method: 'POST',
        token: authToken,
        body: {
          checkout,
          cart: state.cart,
          activeCoupon: state.activeCoupon,
        },
      })
      const order = data.order
      setState((prev) => ({
        ...prev,
        cart: [],
        activeCoupon: null,
        orders: [order, ...prev.orders],
        notifications: [
          {
            id: `n-${Date.now()}`,
            text: `Order confirmation emailed to ${order.userEmail}`,
            type: 'success',
            createdAt: Date.now(),
          },
          ...prev.notifications,
        ],
      }))
      return order
    },
    updateOrderStatus: async (orderId, status) => {
      const data = await api(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        token: authToken,
        body: { status },
      })
      setState((prev) => ({ ...prev, orders: prev.orders.map((o) => (o.id === orderId ? data.order : o)) }))
      pushNotification(`Order ${orderId} marked as ${status}.`, 'info')
    },
    upsertProduct: async (product) => {
      const existing = state.products.some((p) => p.id === product.id)
      if (existing) {
        const data = await api(`/api/products/${product.id}`, { method: 'PUT', token: authToken, body: product })
        setState((prev) => ({ ...prev, products: prev.products.map((p) => (p.id === product.id ? data.product : p)) }))
        pushNotification('Product updated.', 'success')
        return
      }
      const data = await api('/api/products', { method: 'POST', token: authToken, body: product })
      setState((prev) => ({ ...prev, products: [data.product, ...prev.products] }))
      pushNotification('Product created.', 'success')
    },
    deleteProduct: async (id) => {
      await api(`/api/products/${id}`, { method: 'DELETE', token: authToken })
      setState((prev) => ({ ...prev, products: prev.products.filter((p) => p.id !== id) }))
      pushNotification('Product deleted.', 'info')
    },
    uploadProductImage: async (file) => {
      const formData = new FormData()
      formData.append('image', file)
      const data = await api('/api/products/upload-image', {
        method: 'POST',
        token: authToken,
        body: formData,
      })
      pushNotification('Image uploaded successfully.', 'success')
      return data.url
    },
    updateProductStock: async (productId, stock) => {
      const data = await api(`/api/products/${productId}/stock`, {
        method: 'PATCH',
        token: authToken,
        body: { stock },
      })
      setState((prev) => ({ ...prev, products: prev.products.map((p) => (p.id === productId ? data.product : p)) }))
      pushNotification('Product stock updated.', 'success')
    },
    updateUserRole: async (userId, role) => {
      const data = await api(`/api/users/${userId}/role`, {
        method: 'PATCH',
        token: authToken,
        body: { role },
      })
      setState((prev) => ({
        ...prev,
        users: data.users || prev.users.map((u) => (u.id === userId ? data.user : u)),
        currentUser: prev.currentUser?.id === userId ? data.user : prev.currentUser,
      }))
      pushNotification('User role updated.', 'success')
    },
    createSalesAccount: async (payload) => {
      const data = await api('/api/admin/sales-accounts', {
        method: 'POST',
        token: authToken,
        body: payload,
      })
      setState((prev) => ({ ...prev, users: data.users || prev.users }))
      pushNotification('Sales account created.', 'success')
      return data.user
    },
    setSalesAccess: async (userId, blocked, reason = '') => {
      const data = await api(`/api/users/${userId}/access`, {
        method: 'PATCH',
        token: authToken,
        body: { blocked, reason },
      })
      setState((prev) => ({
        ...prev,
        users: data.users || prev.users.map((u) => (u.id === userId ? data.user : u)),
      }))
      pushNotification(blocked ? 'Sales access blocked.' : 'Sales access restored.', blocked ? 'info' : 'success')
      return data.user
    },
    fetchSalesActivity: async () => {
      const data = await api('/api/admin/sales-activity', { token: authToken })
      return data
    },
    setGlobalDiscount: async (globalDiscount) => {
      const data = await api('/api/discounts/global', { method: 'PUT', token: authToken, body: globalDiscount })
      setState((prev) => ({ ...prev, globalDiscount: data.globalDiscount }))
      pushNotification('Global discount updated.', 'success')
    },
    setProductDiscount: async (productId, discount) => {
      const data = await api(`/api/discounts/product/${productId}`, { method: 'PUT', token: authToken, body: discount })
      setState((prev) => ({ ...prev, productDiscounts: data.productDiscounts }))
      pushNotification('Product discount updated.', 'success')
    },
    sendChatMessage: async ({ sender, text, userEmail }) => {
      const payload = { sender, text, userEmail }
      const socket = socketRef.current
      if (socket && socket.connected) {
        socket.emit('chat:send', payload)
        return
      }
      const data = await api('/api/chat/messages', { method: 'POST', body: payload })
      setState((prev) => ({ ...prev, chatMessages: mergeById([...prev.chatMessages, data.message]) }))
    },
    fetchAuditEntries: async (filters = {}) => {
      const search = new URLSearchParams()
      if (filters.limit) {
        search.set('limit', String(filters.limit))
      }
      if (filters.action) {
        search.set('action', filters.action)
      }
      if (filters.actorEmail) {
        search.set('actorEmail', filters.actorEmail)
      }
      if (filters.from) {
        search.set('from', filters.from)
      }
      if (filters.to) {
        search.set('to', filters.to)
      }
      const suffix = search.toString() ? `?${search.toString()}` : ''
      const data = await api(`/api/admin/audit${suffix}`, { token: authToken })
      setState((prev) => ({ ...prev, auditEntries: data.entries || [] }))
      return data.entries || []
    },
    consumeNotification: (id) => {
      setState((prev) => ({ ...prev, notifications: prev.notifications.filter((n) => n.id !== id) }))
    },
    updateProfile: async (updates) => {
      if (!state.currentUser) return
      const data = await api(`/api/users/${state.currentUser.id}`, {
        method: 'PATCH',
        token: authToken,
        body: updates,
      })
      setState((prev) => ({ ...prev, currentUser: data.user }))
      pushNotification('Profile updated successfully.', 'success')
      return data.user
    },
  }

  return { state, actions }
}

function App() {
  const store = useAppStore()
  const Router = window.location.hostname.endsWith('github.io') ? HashRouter : BrowserRouter
  return (
    <Router>
      <AppLayout store={store} />
    </Router>
  )
}

function AppLayout({ store }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { state, actions } = store
  const inAdmin = location.pathname.startsWith('/admin')
  const totals = computeCartTotals(state)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  useEffect(() => {
    if (!state.notifications.length) {
      return
    }
    const id = state.notifications[0]?.id
    const timer = setTimeout(() => {
      actions.consumeNotification(id)
    }, 3200)
    return () => clearTimeout(timer)
  }, [state.notifications, actions])

  const handleLogoutConfirm = () => {
    setShowLogoutConfirm(false)
    actions.signout()
    navigate('/')
  }

  if (state.loading) {
    return <LoadingRouteSkeleton path={location.pathname} />
  }

  return (
    <div className="app-shell">
      <SiteHeader state={state} actions={actions} cartCount={totals.items.length} onLogoutClick={() => setShowLogoutConfirm(true)} />
      {showLogoutConfirm && (
        <ConfirmLogoutModal
          onConfirm={handleLogoutConfirm}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}
      <main>
        <Routes>
          <Route path="/" element={<HomePage state={state} />} />
          <Route path="/products" element={<ProductsPage store={store} />} />
          <Route path="/products/:id" element={<ProductDetailsPage store={store} />} />
          <Route path="/wishlist" element={<PrivateRoute store={store}><WishlistPage store={store} /></PrivateRoute>} />
          <Route path="/signin" element={<GuestRoute store={store}><SignInPage store={store} /></GuestRoute>} />
          <Route path="/signup" element={<GuestRoute store={store}><SignUpPage store={store} /></GuestRoute>} />
          <Route path="/cart" element={<CartPage store={store} />} />
          <Route path="/account" element={<PrivateRoute store={store}><AccountPage store={store} /></PrivateRoute>} />
          <Route path="/checkout" element={<PrivateRoute store={store}><CheckoutPage store={store} /></PrivateRoute>} />
          <Route path="/order-confirmation/:orderId" element={<PrivateRoute store={store}><OrderConfirmationPage store={store} /></PrivateRoute>} />
          <Route path="/admin" element={<AdminRoute store={store}><AdminDashboardPage store={store} /></AdminRoute>} />
          <Route path="/admin/orders" element={<StaffRoute store={store}><AdminOrdersPage store={store} /></StaffRoute>} />
          <Route path="/admin/products" element={<StaffRoute store={store}><AdminProductsPage store={store} /></StaffRoute>} />
          <Route path="/admin/discounts" element={<AdminRoute store={store}><AdminDiscountsPage store={store} /></AdminRoute>} />
          <Route path="/admin/users" element={<AdminRoute store={store}><AdminUsersPage store={store} /></AdminRoute>} />
          <Route path="/admin/chat" element={<AdminRoute store={store}><AdminChatPage store={store} /></AdminRoute>} />
          <Route path="/admin/audit" element={<AdminRoute store={store}><AdminAuditPage store={store} /></AdminRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <SiteFooter />
      {!inAdmin && <ChatWidget store={store} />}
      {state.notifications.slice(0, 1).map((n) => <div className={`toast toast-${n.type || 'info'}`} key={n.id}>{n.text}</div>)}
    </div>
  )
}

function LoadingRouteSkeleton({ path }) {
  const isAccountLike = path.startsWith('/account')

  if (isAccountLike) {
    return (
      <section className="container section account-grid">
        <article className="auth-card skeleton-card">
          <div className="skeleton-line skeleton-lg" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </article>
        <article className="auth-card skeleton-card">
          <div className="skeleton-line skeleton-lg" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </article>
      </section>
    )
  }

  return (
    <section className="container section">
      <div className="section-head">
        <div className="skeleton-line skeleton-lg" />
      </div>
      <div className="product-grid">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <article key={n} className="product-card skeleton-card">
            <div className="skeleton-image" />
            <div className="product-content">
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-lg" />
              <div className="skeleton-line skeleton-sm" />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ConfirmLogoutModal({ onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Confirm Logout</h2>
        <p>Are you sure you want to log out of your account?</p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onConfirm}>Yes, Log Out</button>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function SiteHeader({ state, actions, cartCount, onLogoutClick }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [productsOpen, setProductsOpen] = useState(false)
  const [isDesktopNav, setIsDesktopNav] = useState(false)
  const role = state.currentUser?.role
  const isAdminUser = role === 'admin'
  const isSalesUser = role === 'sales'
  const isStaffUser = isAdminUser || isSalesUser
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return []
    }
    return state.products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5)
  }, [query, state.products])

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1025px)')
    const update = () => {
      setIsDesktopNav(media.matches)
      if (media.matches) {
        setProductsOpen(false)
      }
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const onDocClick = (event) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      if (isDesktopNav) {
        return
      }
      if (!target.closest('.top-nav-dropdown')) {
        setProductsOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [isDesktopNav])

  return (
    <header className="site-header">
      <div className="container nav-wrap">
        <Link to="/" className="logo-wrap">
          <img src={`${import.meta.env.BASE_URL}sameria-logo.png`} alt="Sameria logo" />
          <div>
            <strong>SAMERIA</strong>
            <span>Bangladesh</span>
          </div>
        </Link>
        <form
          className="search-wrap"
          onSubmit={(e) => {
            e.preventDefault()
            navigate(`/products?q=${encodeURIComponent(query)}`)
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search with suggestions"
            aria-label="Search products"
          />
          {suggestions.length > 0 && (
            <div className="suggestions">
              {suggestions.map((s) => (
                <button type="button" key={s.id} onClick={() => navigate(`/products/${s.id}`)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </form>
        <button className="menu-toggle" type="button" onClick={() => setMenuOpen((v) => !v)}>
          {menuOpen ? 'Close' : 'Menu'}
        </button>
        <nav className={`top-nav ${menuOpen ? 'open' : ''}`}>
          {!isStaffUser && (
            <div className="top-nav-dropdown">
              <button
                type="button"
                className="dropdown-trigger"
                onClick={() => {
                  if (!isDesktopNav) {
                    setProductsOpen((v) => !v)
                  }
                }}
                aria-expanded={isDesktopNav ? undefined : productsOpen}
              >
                Products
              </button>
              <div className={`top-nav-menu ${productsOpen ? 'open' : ''}`}>
                <Link to="/products?segment=men" onClick={() => { setMenuOpen(false); setProductsOpen(false) }}>Men</Link>
                <Link to="/products?segment=women" onClick={() => { setMenuOpen(false); setProductsOpen(false) }}>Women</Link>
              </div>
            </div>
          )}
          {state.currentUser ? (
            <>
              {isAdminUser ? (
                <Link to="/admin" onClick={() => setMenuOpen(false)}>Admin</Link>
              ) : isSalesUser ? (
                <Link to="/admin/products" onClick={() => setMenuOpen(false)}>Inventory</Link>
              ) : (
                <>
                  <Link to="/wishlist" onClick={() => setMenuOpen(false)}>Wishlist</Link>
                  <Link to="/cart" onClick={() => setMenuOpen(false)} title={`Cart (${cartCount})`} aria-label={`Cart (${cartCount})`} className="nav-cart-link">
                    <svg className="icon-cart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="20" r="1.5" />
                      <circle cx="18" cy="20" r="1.5" />
                      <path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H7.2" />
                    </svg>
                    {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
                  </Link>
                  <Link to="/account" onClick={() => setMenuOpen(false)} title="Profile" aria-label="Profile" className="nav-profile-link">
                    <svg className="icon-profile" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </Link>
                </>
              )}
              <button className="btn btn-ghost" onClick={() => { onLogoutClick(); setMenuOpen(false) }}>Sign Out</button>
            </>
          ) : (
            <>
              <Link className="signin-subtle" to="/signin" onClick={() => setMenuOpen(false)}>Sign In</Link>
              <Link className="signup-highlight" to="/signup" onClick={() => setMenuOpen(false)}>Sign Up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

function HomePage({ state }) {
  const featured = state.products.filter((p) => p.featured)
  const trending = state.products.filter((p) => p.trending)
  return (
    <>
      <section className="hero">
        <div className="hero-gradient" />
        <div className="container hero-grid">
          <div>
            <p className="kicker">Premium Fashion House</p>
            <h1>SAMERIA: Minimal Luxury, Crafted in Bangladesh</h1>
            <p>
              Explore a modern clothing destination with curated silhouettes, elevated fabrics, and thoughtful details.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-solid" to="/products">Shop Collection</Link>
              <Link className="btn btn-ghost" to="/signup">Join SAMERIA Club</Link>
            </div>
          </div>
          <div className="hero-logo-card">
            <img src={`${import.meta.env.BASE_URL}sameria-logo.png`} alt="Sameria symbol" />
          </div>
        </div>
      </section>

      <section className="container section">
        <div className="section-head">
          <h2>Featured Collections</h2>
          <Link to="/products">View all</Link>
        </div>
        <ProductGrid products={featured} state={state} />
      </section>

      <section className="container promo-banner">
        <div>
          <h3>Seasonal Offer: Up to 25% off selected pieces</h3>
          <p>Use coupon <strong>WELCOME10</strong> or check admin-configured discounts at checkout.</p>
        </div>
        <Link to="/products" className="btn btn-solid">Claim Offer</Link>
      </section>

      <section className="container section">
        <div className="section-head">
          <h2>Trending Now</h2>
        </div>
        <ProductGrid products={trending} state={state} />
      </section>
    </>
  )
}

function ProductGrid({ products, state }) {
  return (
    <div className="product-grid">
      {products.map((p) => {
        const final = productPrice(state, p)
        return (
          <article className="product-card" key={p.id}>
            <img src={p.image} alt={p.name} />
            <div className="product-content">
              <p>{p.category}</p>
              <h3>{p.name}</h3>
              <div className="price-wrap">
                <strong>{currency(final)}</strong>
                {final !== p.price && <span>{currency(p.price)}</span>}
              </div>
              <Link className="btn btn-ghost" to={`/products/${p.id}`}>View Details</Link>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function ProductsPage({ store }) {
  const { state } = store
  const [params, setParams] = useSearchParams()
  const segmentParam = (params.get('segment') || 'all').toLowerCase()
  const [category, setCategory] = useState('all')
  const [segment, setSegment] = useState(segmentParam === 'men' || segmentParam === 'women' ? segmentParam : 'all')
  const [size, setSize] = useState('all')
  const [color, setColor] = useState('all')
  const [sort, setSort] = useState('popular')
  const [maxPrice, setMaxPrice] = useState(10000)
  const q = params.get('q') || ''

  useEffect(() => {
    const next = segmentParam === 'men' || segmentParam === 'women' ? segmentParam : 'all'
    setSegment(next)
  }, [segmentParam])

  function getSegment(product) {
    if (product.category === 'Dresses') {
      return 'women'
    }
    return 'men'
  }

  const products = useMemo(() => {
    let list = state.products.filter((p) => {
      const price = productPrice(state, p)
      return (
        (segment === 'all' || getSegment(p) === segment) &&
        (category === 'all' || p.category === category) &&
        (size === 'all' || p.sizes.includes(size)) &&
        (color === 'all' || p.colors.includes(color)) &&
        price <= maxPrice &&
        (!q || p.name.toLowerCase().includes(q.toLowerCase()))
      )
    })
    if (sort === 'price-low') {
      list = list.sort((a, b) => productPrice(state, a) - productPrice(state, b))
    }
    if (sort === 'price-high') {
      list = list.sort((a, b) => productPrice(state, b) - productPrice(state, a))
    }
    if (sort === 'newest') {
      list = list.sort((a, b) => b.id.localeCompare(a.id))
    }
    if (sort === 'popular') {
      list = list.sort((a, b) => b.reviews - a.reviews)
    }
    return list
  }, [state, segment, category, size, color, sort, maxPrice, q])

  const categories = ['all', ...new Set(state.products.map((p) => p.category))]
  const sizes = ['all', ...new Set(state.products.flatMap((p) => p.sizes))]
  const colors = ['all', ...new Set(state.products.flatMap((p) => p.colors))]

  return (
    <section className="container section listing-page">
      <div className="filters">
        <h2>Filters</h2>
        <label>Products
          <select value={segment} onChange={(e) => setSegment(e.target.value)}>
            <option value="all">All</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
          </select>
        </label>
        <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label>Size<select value={size} onChange={(e) => setSize(e.target.value)}>{sizes.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Color<select value={color} onChange={(e) => setColor(e.target.value)}>{colors.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label>Max price ({currency(maxPrice)})
          <input type="range" min="1000" max="10000" step="100" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} />
        </label>
      </div>

      <div>
        <div className="list-head">
          <h2>All Products ({products.length})</h2>
          <div className="sort-wrap">
            <label>Sort by
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="popular">Popular</option>
                <option value="newest">Newest</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
              </select>
            </label>
          </div>
        </div>
        {q && <p className="search-chip">Search: {q} <button onClick={() => setParams({})}>Clear</button></p>}
        <ProductGrid products={products} state={state} />
      </div>
    </section>
  )
}

function ProductDetailsPage({ store }) {
  const { state, actions } = store
  const { id } = useParams()
  const navigate = useNavigate()
  const product = state.products.find((p) => p.id === id)
  const [size, setSize] = useState(product?.sizes?.[0] || 'M')

  if (!product) {
    return <section className="container section"><h2>Product not found</h2></section>
  }

  const price = productPrice(state, product)

  return (
    <section className="container section details-grid">
      <div className="gallery">
        <img src={product.image} alt={product.name} />
        <div className="thumbs">
          <img src={product.image} alt={`${product.name} preview`} />
          <img src={product.image} alt={`${product.name} preview two`} />
          <img src={product.image} alt={`${product.name} preview three`} />
        </div>
      </div>
      <div className="details-content">
        <p className="kicker">{product.category}</p>
        <h2>{product.name}</h2>
        <p className="rating">{product.rating}★ ({product.reviews} reviews)</p>
        <p>{product.description}</p>
        <div className="price-wrap"><strong>{currency(price)}</strong>{price !== product.price && <span>{currency(product.price)}</span>}</div>
        <label>Size
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            {product.sizes.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <div className="details-actions">
          <button className="btn btn-solid" onClick={() => actions.addToCart(product.id, size)}>Add to Cart</button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              actions.addToCart(product.id, size)
              if (!state.currentUser) {
                navigate('/signin', { state: { from: '/checkout' } })
                return
              }
              navigate('/checkout')
            }}
          >
            Buy Now
          </button>
          <button className="btn btn-ghost" onClick={() => actions.toggleWishlist(product.id)}>
            {state.wishlist.includes(product.id) ? 'Remove Wishlist' : 'Add Wishlist'}
          </button>
        </div>
      </div>
    </section>
  )
}

function SignInPage({ store }) {
  const { actions } = store
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(0)

  useEffect(() => {
    if (!lockedUntil) {
      return
    }
    const timer = setInterval(() => {
      if (Date.now() >= lockedUntil) {
        setLockedUntil(0)
      }
    }, 250)
    return () => clearInterval(timer)
  }, [lockedUntil])

  const lockSeconds = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0

  return (
    <section className="container section auth-card">
      <h2>Sign In</h2>
      <p>Guest browsing is allowed, but login is required to purchase.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (lockSeconds > 0) {
            setError(`Please wait ${lockSeconds}s before trying again.`)
            return
          }
          const validation = validateSignInForm(form)
          if (!validation.success) {
            setError(firstIssueMessage(validation, 'Please check your input'))
            return
          }
          setSubmitting(true)
          setError('')
          try {
            const user = await actions.signin(form)
            // Redirect based on user role
            if (user?.role === 'admin') {
              navigate('/admin')
            } else if (user?.role === 'sales') {
              navigate('/admin/products')
            } else {
              const redirect = location.state?.from || '/products'
              navigate(redirect)
            }
          } catch (err) {
            if (err instanceof ApiError && err.status === 429) {
              const seconds = Number(err.retryAfter || 1)
              setLockedUntil(Date.now() + seconds * 1000)
              setError(`Too many attempts. Try again in ${seconds}s.`)
            } else {
              setError(formatApiErrorMessage(err, 'Invalid credentials'))
            }
          } finally {
            setSubmitting(false)
          }
        }}
      >
        <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Password<input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-solid" type="submit" disabled={submitting || lockSeconds > 0}>{submitting ? 'Signing In...' : 'Sign In'}</button>
      </form>
      <p>Admin demo: admin@sameria.com / admin123</p>
      <Link to="/signup">Create account</Link>
    </section>
  )
}

function SignUpPage({ store }) {
  const { actions } = store
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' })

  return (
    <section className="container section auth-card">
      <h2>Sign Up</h2>
      <form
        className="signup-form"
        onSubmit={async (e) => {
          e.preventDefault()
          const validation = validateSignUpForm(form)
          if (!validation.success) {
            setError(firstIssueMessage(validation, 'Please check your details'))
            return
          }
          setSubmitting(true)
          setError('')
          try {
            await actions.signup(form)
            navigate('/products')
          } catch (err) {
            setError(formatApiErrorMessage(err, 'Could not create account'))
          } finally {
            setSubmitting(false)
          }
        }}
      >
        <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Password<input type="password" minLength="8" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <label>Phone<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        {error && <p className="error-text">{error}</p>}
        <div className="auth-actions-row">
          <button className="btn btn-solid" type="submit" disabled={submitting}>{submitting ? 'Creating...' : 'Create Account'}</button>
        </div>
      </form>
      <Link className="auth-secondary-link" to="/signin">Already have an account?</Link>
    </section>
  )
}

function AccountPage({ store }) {
  const { state, actions } = store
  const orders = state.orders
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState({ name: '', email: '', phone: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleEditClick = () => {
    setEditData({
      name: state.currentUser?.name || '',
      email: state.currentUser?.email || '',
      phone: state.currentUser?.phone || '',
    })
    setEditMode(true)
    setError('')
  }

  const handleCancel = () => {
    setEditMode(false)
    setEditData({ name: '', email: '', phone: '' })
    setError('')
  }

  const handleSave = async () => {
    try {
      setLoading(true)
      setError('')
      await actions.updateProfile(editData)
      setEditMode(false)
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Failed to update profile'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="container section account-grid">
      <article className="auth-card">
        <div className="account-header">
          <h2>My Account</h2>
          <button className="btn-icon" onClick={handleEditClick} title="Edit Profile" aria-label="Edit Profile" disabled={editMode}>
            <svg className="icon-pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </div>
        {editMode ? (
          <form className="profile-edit-form" onSubmit={(e) => { e.preventDefault(); handleSave() }}>
            {error && <p className="error-message">{error}</p>}
            <label>
              Name
              <input
                type="text"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={editData.email}
                onChange={(e) => setEditData({ ...editData, email: e.target.value })}
              />
            </label>
            <label>
              Phone
              <input
                type="tel"
                value={editData.phone}
                onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
              />
            </label>
            <div className="profile-actions">
              <button className="btn btn-solid" type="submit" disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={handleCancel} disabled={loading}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p><strong>Name:</strong> {state.currentUser?.name}</p>
            <p><strong>Email:</strong> {state.currentUser?.email}</p>
            <p><strong>Phone:</strong> {state.currentUser?.phone || 'Not set'}</p>
            <p><strong>Wishlist Items:</strong> {state.wishlist.length}</p>
          </>
        )}
      </article>
      <article className="auth-card">
        <h2>My Orders</h2>
        {orders.length === 0 && <p>You have no orders yet.</p>}
        <div className="orders-list">
          {orders.slice(0, 8).map((order) => (
            <div className="order-row" key={order.id}>
              <div className="order-row-meta">
                <strong>{order.id}</strong>
                <p>{new Date(order.createdAt).toLocaleString()}</p>
              </div>
              <div className="order-row-sum">
                <p>{currency(order.totals.total)}</p>
                <p className={`status-pill status-${order.status}`}>{order.status}</p>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}

function WishlistPage({ store }) {
  const { state } = store
  const products = state.products.filter((p) => state.wishlist.includes(p.id))
  return (
    <section className="container section">
      <h2>Wishlist</h2>
      {products.length === 0 ? <p>No items yet.</p> : <ProductGrid products={products} state={state} />}
    </section>
  )
}

function CartPage({ store }) {
  const { state, actions } = store
  const totals = computeCartTotals(state)
  const [coupon, setCoupon] = useState('')
  const [couponMsg, setCouponMsg] = useState('')
  const hasItems = totals.items.length > 0
  return (
    <section className="container section cart-layout">
      <div>
        <h2>Cart</h2>
        {totals.items.length === 0 && <p>Your cart is empty.</p>}
        {totals.items.map((item) => (
          <article className="cart-item" key={item.id}>
            <img src={item.product.image} alt={item.product.name} />
            <div>
              <h3>{item.product.name}</h3>
              <p>Size: {item.size}</p>
              <p>{currency(item.unit)}</p>
            </div>
            <input
              type="number"
              min="1"
              value={item.quantity}
              onChange={(e) => actions.updateCartQty(item.id, Number(e.target.value))}
            />
            <button className="btn btn-ghost" onClick={() => actions.removeCartItem(item.id)}>Remove</button>
          </article>
        ))}
      </div>
      <aside className="summary-card">
        <h3>Price Summary</h3>
        <p><span>Subtotal</span><strong>{currency(totals.subtotal)}</strong></p>
        <p><span>Coupon</span><strong>-{currency(totals.couponDiscount)}</strong></p>
        <p><span>Shipping</span><strong>{currency(totals.shipping)}</strong></p>
        <p className="total"><span>Total</span><strong>{currency(totals.total)}</strong></p>
        <div className="coupon-line">
          <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Coupon code" />
          <button
            className="btn btn-ghost"
            onClick={async () => {
              try {
                await actions.applyCoupon(coupon)
                setCouponMsg('Coupon applied')
              } catch (err) {
                setCouponMsg(formatApiErrorMessage(err, 'Invalid coupon'))
              }
            }}
          >
            Apply
          </button>
        </div>
        {couponMsg && <p>{couponMsg}</p>}
        {hasItems ? <Link className="btn btn-solid" to="/checkout">Checkout</Link> : <button className="btn btn-solid" disabled>Checkout</button>}
      </aside>
    </section>
  )
}

function CheckoutPage({ store }) {
  const { state, actions } = store
  const navigate = useNavigate()
  const totals = computeCartTotals(state)
  const [form, setForm] = useState({ address: '', phone: '', paymentMethod: 'Cash on Delivery' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  return (
    <section className="container section cart-layout">
      <div className="auth-card">
        <h2>Checkout</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const validation = validateCheckoutForm(form)
            if (!validation.success) {
              setError(firstIssueMessage(validation, 'Please review checkout details'))
              return
            }
            setSubmitting(true)
            setError('')
            try {
              const order = await actions.placeOrder(form)
              if (order) {
                navigate(`/order-confirmation/${order.id}`)
              }
            } catch (err) {
              setError(formatApiErrorMessage(err, 'Checkout failed. Please try again.'))
            } finally {
              setSubmitting(false)
            }
          }}
        >
          <label>Address<input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
          <label>Phone<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Payment Method
            <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
              <option>Cash on Delivery</option>
              <option>bKash</option>
              <option>Nagad</option>
              <option>Card</option>
            </select>
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-solid" type="submit" disabled={submitting || totals.items.length === 0}>{submitting ? 'Placing...' : 'Place Order'}</button>
        </form>
      </div>
      <aside className="summary-card">
        <h3>Final Total</h3>
        <p className="total"><span>Amount Due</span><strong>{currency(totals.total)}</strong></p>
      </aside>
    </section>
  )
}

function OrderConfirmationPage({ store }) {
  const { state } = store
  const { orderId } = useParams()
  const order = state.orders.find((o) => o.id === orderId)
  if (!order) {
    return <section className="container section"><h2>Order not found</h2></section>
  }
  return (
    <section className="container section auth-card">
      <h2>Order Confirmed</h2>
      <div className="order-confirmation-body">
        <p>Your order ID is <strong>{order.id}</strong>.</p>
        <p>Status: <strong>{order.status}</strong></p>
        <p>We sent an email confirmation to {order.userEmail}.</p>
        <div className="auth-actions-row">
          <Link to="/products" className="btn btn-solid">Continue Shopping</Link>
        </div>
      </div>
    </section>
  )
}

function PrivateRoute({ store, children }) {
  const location = useLocation()
  if (!store.state.currentUser) {
    return <Navigate to="/signin" state={{ from: location.pathname }} replace />
  }
  return children
}

function GuestRoute({ store, children }) {
  if (store.state.currentUser) {
    const role = store.state.currentUser.role
    return <Navigate to={role === 'admin' ? '/admin' : role === 'sales' ? '/admin/orders' : '/'} replace />
  }
  return children
}

function AdminRoute({ store, children }) {
  const user = store.state.currentUser
  if (!user || user.role !== 'admin') {
    return <Navigate to="/signin" replace />
  }
  return <AdminLayout userRole={user.role}>{children}</AdminLayout>
}

function StaffRoute({ store, children }) {
  const user = store.state.currentUser
  if (!user || (user.role !== 'admin' && user.role !== 'sales')) {
    return <Navigate to="/signin" replace />
  }
  return <AdminLayout userRole={user.role}>{children}</AdminLayout>
}

function AdminLayout({ children, userRole }) {
  const isAdmin = userRole === 'admin'
  const isStaff = userRole === 'admin' || userRole === 'sales'
  return (
    <section className="container section admin-shell">
      <aside className="admin-nav">
        <h3>Admin Panel</h3>
        {isAdmin && <Link to="/admin">Dashboard</Link>}
        <Link to="/admin/products">Products</Link>
        {isStaff && <Link to="/admin/orders">Orders</Link>}
        {isAdmin && <Link to="/admin/discounts">Discounts</Link>}
        {isAdmin && <Link to="/admin/users">Users</Link>}
        {isAdmin && <Link to="/admin/chat">Chat</Link>}
        {isAdmin && <Link to="/admin/audit">Audit</Link>}
      </aside>
      <div>{children}</div>
    </section>
  )
}

function AdminDashboardPage({ store }) {
  const { state } = store
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  const metrics = useMemo(() => {
    const revenue = state.orders.reduce((sum, order) => sum + order.totals.total, 0)
    const monthlyOrders = state.orders.filter((order) => order.createdAt > monthAgo)
    const monthRevenue = monthlyOrders.reduce((sum, order) => sum + order.totals.total, 0)
    const deliveredOrdersList = state.orders.filter((order) => order.status === 'delivered')
    const deliveredRevenue = deliveredOrdersList.reduce((sum, order) => sum + order.totals.total, 0)
    const soldUnits = deliveredOrdersList.reduce(
      (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0,
    )
    const averageOrderValue = state.orders.length ? Math.round(revenue / state.orders.length) : 0
    const pendingOrders = state.orders.filter((order) => order.status === 'pending').length
    const deliveredOrders = deliveredOrdersList.length
    const deliveredRate = state.orders.length ? Math.round((deliveredOrders / state.orders.length) * 100) : 0
    const activeProductDiscounts = Object.values(state.productDiscounts || {}).filter((d) => d?.enabled).length
    const activeDiscounts = (state.globalDiscount?.enabled ? 1 : 0) + activeProductDiscounts

    const statusBreakdown = ['pending', 'shipped', 'delivered', 'cancelled'].map((status) => ({
      status,
      count: state.orders.filter((order) => order.status === status).length,
    }))

    const topProductsMap = {}
    deliveredOrdersList.forEach((order) => {
      order.items.forEach((item) => {
        const key = item.productId
        if (!topProductsMap[key]) {
          topProductsMap[key] = {
            id: key,
            name: item.product?.name || key,
            qty: 0,
            revenue: 0,
          }
        }
        topProductsMap[key].qty += item.quantity
        topProductsMap[key].revenue += item.line
      })
    })

    const topProducts = Object.values(topProductsMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    const lowStockProducts = [...state.products]
      .sort((a, b) => a.stock - b.stock)
      .filter((product) => product.stock <= 10)
      .slice(0, 5)

    const productStatusSummary = [
      {
        status: 'in-stock',
        label: 'In Stock',
        count: state.products.filter((product) => product.stock > 10).length,
      },
      {
        status: 'low-stock',
        label: 'Low Stock',
        count: state.products.filter((product) => product.stock > 0 && product.stock <= 10).length,
      },
      {
        status: 'out-of-stock',
        label: 'Out of Stock',
        count: state.products.filter((product) => product.stock === 0).length,
      },
    ]

    return {
      revenue,
      monthRevenue,
      deliveredRevenue,
      soldUnits,
      averageOrderValue,
      pendingOrders,
      deliveredRate,
      activeDiscounts,
      statusBreakdown,
      topProducts,
      lowStockProducts,
      productStatusSummary,
      recentOrders: state.orders.slice(0, 6),
      monthlyOrdersCount: monthlyOrders.length,
    }
  }, [state.orders, state.products, state.productDiscounts, state.globalDiscount, monthAgo])

  return (
    <div>
      <h2>Dashboard Overview</h2>
      <div className="stats-grid">
        <article><p>Total Orders</p><strong>{state.orders.length}</strong></article>
        <article><p>Total Revenue</p><strong>{currency(metrics.revenue)}</strong></article>
        <article><p>Monthly Sales (30d)</p><strong>{currency(metrics.monthRevenue)}</strong></article>
        <article><p>Delivered Sales</p><strong>{currency(metrics.deliveredRevenue)}</strong></article>
        <article><p>Monthly Orders (30d)</p><strong>{metrics.monthlyOrdersCount}</strong></article>
        <article><p>Average Order Value</p><strong>{currency(metrics.averageOrderValue)}</strong></article>
        <article><p>Pending Orders</p><strong>{metrics.pendingOrders}</strong></article>
        <article><p>Sold Units</p><strong>{metrics.soldUnits}</strong></article>
        <article><p>Delivered Rate</p><strong>{metrics.deliveredRate}%</strong></article>
        <article><p>Active Discounts</p><strong>{metrics.activeDiscounts}</strong></article>
      </div>

      <div className="stats-grid order-status-grid">
        {metrics.statusBreakdown.map((entry) => (
          <article key={entry.status}>
            <p>Orders: {entry.status}</p>
            <strong>{entry.count}</strong>
          </article>
        ))}
      </div>

      <div className="stats-grid order-status-grid">
        {metrics.productStatusSummary.map((entry) => (
          <article key={entry.status}>
            <p>{entry.label}</p>
            <strong>{entry.count}</strong>
          </article>
        ))}
      </div>

      <div className="admin-overview-grid">
        <article className="admin-card">
          <h3>Top Selling Products</h3>
          {metrics.topProducts.length === 0 && <p>No sales data yet.</p>}
          {metrics.topProducts.map((product) => (
            <div className="order-row" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <p>Units sold: {product.qty}</p>
                <p>Stock status: {inventoryStatus(state.products.find((item) => item.id === product.id)?.stock ?? 0)}</p>
              </div>
              <p>{currency(product.revenue)}</p>
            </div>
          ))}
        </article>

        <article className="admin-card">
          <h3>Low Stock Alerts</h3>
          {metrics.lowStockProducts.length === 0 && <p>All products are sufficiently stocked.</p>}
          {metrics.lowStockProducts.map((product) => (
            <div className="order-row" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <p>{product.category}</p>
                <p>{inventoryStatus(product.stock)}</p>
              </div>
              <p>{product.stock} left</p>
            </div>
          ))}
        </article>

        <article className="admin-card admin-overview-span">
          <h3>Recent Orders</h3>
          {metrics.recentOrders.length === 0 && <p>No recent orders.</p>}
          {metrics.recentOrders.map((order) => (
            <div className="order-row" key={order.id}>
              <div>
                <strong>{order.id}</strong>
                <p>{order.userEmail}</p>
                <p>{new Date(order.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p>{currency(order.totals.total)}</p>
                <p className={`status-pill status-${order.status}`}>{order.status}</p>
              </div>
            </div>
          ))}
        </article>
      </div>
    </div>
  )
}

function AdminOrdersPage({ store }) {
  const { state, actions } = store
  const userRole = state.currentUser?.role
  const isSalesUser = userRole === 'sales'
  return (
    <div>
      <h2>Order Management</h2>
      {isSalesUser && <p>Sales users can confirm deliveries only.</p>}
      {state.orders.map((o) => (
        <article className="admin-card" key={o.id}>
          <p><strong>{o.id}</strong> | {o.userEmail}</p>
          <p>{new Date(o.createdAt).toLocaleString()}</p>
          <p>Total {currency(o.totals.total)}</p>
          {isSalesUser ? (
            <div className="inline-actions">
              <button
                className="btn btn-solid"
                disabled={o.status === 'delivered' || o.status === 'cancelled'}
                onClick={() => actions.updateOrderStatus(o.id, 'delivered')}
              >
                {o.status === 'delivered' ? 'Delivery Confirmed' : 'Confirm Delivery'}
              </button>
            </div>
          ) : (
            <div className="inline-actions">
              <button className="btn btn-ghost" onClick={() => actions.updateOrderStatus(o.id, 'pending')}>Pending</button>
              <button className="btn btn-ghost" onClick={() => actions.updateOrderStatus(o.id, 'shipped')}>Shipped</button>
              <button className="btn btn-ghost" onClick={() => actions.updateOrderStatus(o.id, 'delivered')}>Delivered</button>
              <button className="btn btn-ghost" onClick={() => actions.updateOrderStatus(o.id, 'cancelled')}>Cancel</button>
            </div>
          )}
          <p>Status: <strong>{o.status}</strong></p>
        </article>
      ))}
      {state.orders.length === 0 && <p>No orders yet.</p>}
    </div>
  )
}

function AdminProductsPage({ store }) {
  const { state, actions } = store
  const isSalesUser = state.currentUser?.role === 'sales'
  const isAdminUser = state.currentUser?.role === 'admin'
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [selectedImageFile, setSelectedImageFile] = useState(null)
  const [form, setForm] = useState({
    id: '',
    name: '',
    price: 2500,
    stock: 10,
    category: 'Shirts',
    sizes: 'S,M,L',
    colors: 'Deep Green,Sand',
    image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=900&q=80',
    description: 'New SAMERIA product',
    rating: 4.5,
    reviews: 0,
    featured: false,
    trending: false,
  })

  return (
    <div>
      <h2>{isSalesUser ? 'Product Update (Sales Team)' : 'Product Management'}</h2>
      <form
        className="admin-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setError('')

          if (isSalesUser && !form.id) {
            setError('Sales team can edit existing products. Select a product first.')
            return
          }

          const validation = validateProductForm(form)
          if (!validation.success) {
            setError(firstIssueMessage(validation, 'Please review product fields'))
            return
          }

          try {
            await actions.upsertProduct({
              ...form,
              price: Number(form.price),
              stock: Number(form.stock),
              rating: Number(form.rating),
              reviews: Number(form.reviews),
              sizes: form.sizes.split(',').map((x) => x.trim()),
              colors: form.colors.split(',').map((x) => x.trim()),
            })
            setSelectedImageFile(null)
            setForm((prev) => ({ ...prev, id: '', name: '' }))
          } catch (err) {
            setError(formatApiErrorMessage(err, 'Could not save product'))
          }
        }}
      >
        <h3>{form.id ? 'Edit Product' : 'Add Product'}</h3>
        <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Price<input type="number" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
        <label>Stock<input type="number" required value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label>
        <label>Category<input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
        <label>Sizes (comma separated)<input required value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} /></label>
        <label>Colors (comma separated)<input required value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} /></label>
        <label>Image URL<input required value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} /></label>
        <label>
          Upload Product Image
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setSelectedImageFile(e.target.files?.[0] || null)}
          />
        </label>
        <div className="inline-actions">
          <button
            className="btn btn-ghost"
            type="button"
            disabled={!selectedImageFile || uploading}
            onClick={async () => {
              if (!selectedImageFile) {
                return
              }
              try {
                setError('')
                setUploading(true)
                const uploadedUrl = await actions.uploadProductImage(selectedImageFile)
                setForm((prev) => ({ ...prev, image: uploadedUrl }))
              } catch (err) {
                setError(formatApiErrorMessage(err, 'Could not upload image'))
              } finally {
                setUploading(false)
              }
            }}
          >
            {uploading ? 'Uploading...' : 'Upload Image'}
          </button>
          {form.image && <span>Current image ready</span>}
        </div>
        <label>Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="inline-actions">
          <label><input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured</label>
          <label><input type="checkbox" checked={form.trending} onChange={(e) => setForm({ ...form, trending: e.target.checked })} /> Trending</label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-solid" type="submit">{form.id ? 'Update Product' : 'Save Product'}</button>
      </form>

      {state.products.map((p) => (
        <article key={p.id} className="admin-card">
          <p><strong>{p.name}</strong> ({currency(p.price)})</p>
          <p>Stock: {p.stock} | Status: {inventoryStatus(p.stock)} | Category: {p.category}</p>
          <div className="inline-actions">
            <button className="btn btn-ghost" onClick={() => setForm({ ...p, sizes: p.sizes.join(','), colors: p.colors.join(',') })}>Edit</button>
            {isAdminUser && <button className="btn btn-ghost" onClick={() => actions.deleteProduct(p.id)}>Delete</button>}
          </div>
        </article>
      ))}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

function AdminDiscountsPage({ store }) {
  const { state, actions } = store
  const [error, setError] = useState('')
  const [globalForm, setGlobalForm] = useState(state.globalDiscount)
  const [selected, setSelected] = useState(state.products[0]?.id || '')
  const [productForm, setProductForm] = useState(state.productDiscounts[selected] || { enabled: false, type: 'percent', value: 10 })

  useEffect(() => {
    setProductForm(state.productDiscounts[selected] || { enabled: false, type: 'percent', value: 10 })
  }, [selected, state.productDiscounts])

  return (
    <div>
      <h2>Discount System</h2>
      {error && <p className="error-text">{error}</p>}
      <article className="admin-card">
        <h3>Entire Store Discount</h3>
        <p>Status: <strong>{globalForm.enabled ? 'Open' : 'Closed'}</strong></p>
        <label><input type="checkbox" checked={globalForm.enabled} onChange={(e) => setGlobalForm({ ...globalForm, enabled: e.target.checked })} /> Enable</label>
        <label>Type<select value={globalForm.type} onChange={(e) => setGlobalForm({ ...globalForm, type: e.target.value })}><option value="percent">Percent</option><option value="fixed">Fixed</option></select></label>
        <label>Value<input type="number" value={globalForm.value} onChange={(e) => setGlobalForm({ ...globalForm, value: Number(e.target.value) })} /></label>
        <div className="inline-actions">
          <button
            className="btn btn-solid"
            onClick={async () => {
              try {
                setError('')
                await actions.setGlobalDiscount({ ...globalForm, enabled: true })
                setGlobalForm((prev) => ({ ...prev, enabled: true }))
              } catch (err) {
                setError(formatApiErrorMessage(err, 'Could not open global discount'))
              }
            }}
          >
            Open Discount
          </button>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              try {
                setError('')
                await actions.setGlobalDiscount({ ...globalForm, enabled: false })
                setGlobalForm((prev) => ({ ...prev, enabled: false }))
              } catch (err) {
                setError(formatApiErrorMessage(err, 'Could not close global discount'))
              }
            }}
          >
            Close Discount
          </button>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              try {
                setError('')
                await actions.setGlobalDiscount(globalForm)
              } catch (err) {
                setError(formatApiErrorMessage(err, 'Could not save global discount'))
              }
            }}
          >
            Save Settings
          </button>
        </div>
      </article>

      <article className="admin-card">
        <h3>Specific Product Discount</h3>
        <label>Product<select value={selected} onChange={(e) => setSelected(e.target.value)}>{state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <p>Status: <strong>{productForm.enabled ? 'Open' : 'Closed'}</strong></p>
        <label><input type="checkbox" checked={productForm.enabled} onChange={(e) => setProductForm({ ...productForm, enabled: e.target.checked })} /> Enable</label>
        <label>Type<select value={productForm.type} onChange={(e) => setProductForm({ ...productForm, type: e.target.value })}><option value="percent">Percent</option><option value="fixed">Fixed</option></select></label>
        <label>Value<input type="number" value={productForm.value} onChange={(e) => setProductForm({ ...productForm, value: Number(e.target.value) })} /></label>
        <div className="inline-actions">
          <button
            className="btn btn-solid"
            onClick={async () => {
              try {
                setError('')
                await actions.setProductDiscount(selected, { ...productForm, enabled: true })
                setProductForm((prev) => ({ ...prev, enabled: true }))
              } catch (err) {
                setError(formatApiErrorMessage(err, 'Could not open product discount'))
              }
            }}
          >
            Open Discount
          </button>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              try {
                setError('')
                await actions.setProductDiscount(selected, { ...productForm, enabled: false })
                setProductForm((prev) => ({ ...prev, enabled: false }))
              } catch (err) {
                setError(formatApiErrorMessage(err, 'Could not close product discount'))
              }
            }}
          >
            Close Discount
          </button>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              try {
                setError('')
                await actions.setProductDiscount(selected, productForm)
              } catch (err) {
                setError(formatApiErrorMessage(err, 'Could not save product discount'))
              }
            }}
          >
            Save Settings
          </button>
        </div>
      </article>
    </div>
  )
}

function AdminUsersPage({ store }) {
  const { state, actions } = store
  const [error, setError] = useState('')
  const [activityLoading, setActivityLoading] = useState(true)
  const [activityData, setActivityData] = useState({ summary: [], entries: [] })
  const [accessReason, setAccessReason] = useState({})
  const [salesForm, setSalesForm] = useState({ name: '', email: '', password: '', phone: '' })

  const updateRole = async (userId, role) => {
    try {
      setError('')
      await actions.updateUserRole(userId, role)
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not update role'))
    }
  }

  const loadSalesActivity = async () => {
    try {
      setActivityLoading(true)
      setError('')
      const data = await actions.fetchSalesActivity()
      setActivityData(data)
    } catch (err) {
      const message = formatApiErrorMessage(err, 'Could not load sales activity')
      if (message.toLowerCase() === 'request failed') {
        setError('Backend not reachable or outdated. Restart the server on port 4000 and reload this page.')
      } else {
        setError(message)
      }
    } finally {
      setActivityLoading(false)
    }
  }

  useEffect(() => {
    loadSalesActivity()
  }, [])

  const salesUsers = state.users.filter((u) => u.role === 'sales')

  return (
    <div>
      <h2>User Management</h2>
      {error && <p className="error-text">{error}</p>}

      <article className="admin-card">
        <h3>Create Sales Account</h3>
        <form
          className="sales-account-form"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              setError('')
              await actions.createSalesAccount(salesForm)
              setSalesForm({ name: '', email: '', password: '', phone: '' })
              await loadSalesActivity()
            } catch (err) {
              setError(formatApiErrorMessage(err, 'Could not create sales account'))
            }
          }}
        >
          <label>Name<input required value={salesForm.name} onChange={(e) => setSalesForm({ ...salesForm, name: e.target.value })} /></label>
          <label>Email<input type="email" required value={salesForm.email} onChange={(e) => setSalesForm({ ...salesForm, email: e.target.value })} /></label>
          <label>Password<input type="password" minLength="8" required value={salesForm.password} onChange={(e) => setSalesForm({ ...salesForm, password: e.target.value })} /></label>
          <label>Phone<input required value={salesForm.phone} onChange={(e) => setSalesForm({ ...salesForm, phone: e.target.value })} /></label>
          <div className="auth-actions-row">
            <button className="btn btn-solid sales-create-btn" type="submit">Create Sales Account</button>
          </div>
        </form>
      </article>

      <article className="admin-card">
        <div className="inline-actions" style={{ justifyContent: 'space-between' }}>
          <h3>Sales Team Activity Monitor</h3>
          <button className="btn btn-ghost" type="button" onClick={loadSalesActivity}>Refresh</button>
        </div>
        {activityLoading && <p>Loading sales activity...</p>}
        {!activityLoading && activityData.summary.length === 0 && <p>No sales users yet.</p>}
        {!activityLoading && activityData.summary.map((entry) => (
          <div className="order-row" key={entry.userId}>
            <div>
              <strong>{entry.name}</strong>
              <p>{entry.email}</p>
              <p>Last activity: {entry.lastActivity ? new Date(entry.lastActivity).toLocaleString() : 'No activity yet'}</p>
            </div>
            <div>
              <p>Events: {entry.activityCount}</p>
              <p>Rejected/Blocked: {entry.rejectedCount}</p>
              <p className={`status-pill ${entry.blocked ? 'status-cancelled' : 'status-delivered'}`}>{entry.blocked ? 'Blocked' : 'Active'}</p>
            </div>
          </div>
        ))}
      </article>

      {salesUsers.map((u) => (
        <article key={`sales-access-${u.id}`} className="admin-card">
          <p><strong>{u.name}</strong> ({u.role})</p>
          <p>{u.email}</p>
          <p>{u.phone}</p>
          <p>Status: <strong>{u.isBlocked ? `Blocked${u.blockedReason ? ` (${u.blockedReason})` : ''}` : 'Active'}</strong></p>
          <label>
            Reason (for block)
            <input
              value={accessReason[u.id] || ''}
              placeholder="Suspicious stock edits, unusual login attempts..."
              onChange={(e) => setAccessReason((prev) => ({ ...prev, [u.id]: e.target.value }))}
            />
          </label>
          <div className="inline-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={async () => {
                try {
                  setError('')
                  await actions.setSalesAccess(u.id, true, accessReason[u.id] || 'Blocked by admin')
                  await loadSalesActivity()
                } catch (err) {
                  setError(formatApiErrorMessage(err, 'Could not block sales access'))
                }
              }}
            >
              Block Access
            </button>
            <button
              className="btn btn-solid"
              type="button"
              onClick={async () => {
                try {
                  setError('')
                  await actions.setSalesAccess(u.id, false)
                  await loadSalesActivity()
                } catch (err) {
                  setError(formatApiErrorMessage(err, 'Could not unblock sales access'))
                }
              }}
            >
              Restore Access
            </button>
          </div>
        </article>
      ))}

      {state.users.filter((u) => u.role !== 'sales').map((u) => (
        <article key={u.id} className="admin-card">
          <p><strong>{u.name}</strong> ({u.role})</p>
          <p>{u.email}</p>
          <p>{u.phone}</p>
          <div className="inline-actions">
            <button className="btn btn-ghost" onClick={() => updateRole(u.id, 'customer')}>Set Customer</button>
            <button className="btn btn-ghost" onClick={() => updateRole(u.id, 'sales')}>Set Sales</button>
            <button className="btn btn-ghost" onClick={() => updateRole(u.id, 'admin')}>Set Admin</button>
          </div>
        </article>
      ))}

      {activityData.entries.length > 0 && (
        <article className="admin-card">
          <h3>Recent Sales Events</h3>
          {activityData.entries.slice(0, 20).map((entry, idx) => (
            <p key={`${entry.ts}-${idx}`}>
              <strong>{entry.action}</strong> [{entry.outcome}] - {entry.actorEmail || 'unknown'} - {new Date(entry.ts).toLocaleString()}
            </p>
          ))}
        </article>
      )}
    </div>
  )
}

function AdminAuditPage({ store }) {
  const { state, actions } = store
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ limit: 100, action: '', actorEmail: '', from: '', to: '' })

  const load = async (nextFilters = filters) => {
    try {
      setLoading(true)
      setError('')
      await actions.fetchAuditEntries(nextFilters)
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not load audit entries'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(filters)
  }, [])

  return (
    <div>
      <h2>Audit Logs</h2>
      <form
        className="admin-card"
        onSubmit={async (e) => {
          e.preventDefault()
          await load(filters)
        }}
      >
        <label>Action
          <input value={filters.action} placeholder="admin.product.create" onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        </label>
        <label>Actor Email
          <input value={filters.actorEmail} placeholder="admin@sameria.com" onChange={(e) => setFilters({ ...filters, actorEmail: e.target.value })} />
        </label>
        <label>From (ISO)
          <input value={filters.from} placeholder="2026-03-01T00:00:00.000Z" onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </label>
        <label>To (ISO)
          <input value={filters.to} placeholder="2026-03-31T23:59:59.000Z" onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </label>
        <label>Limit
          <input type="number" min="1" max="500" value={filters.limit} onChange={(e) => setFilters({ ...filters, limit: Number(e.target.value || 100) })} />
        </label>
        <div className="inline-actions">
          <button className="btn btn-solid" type="submit">Apply Filters</button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={async () => {
              const reset = { limit: 100, action: '', actorEmail: '', from: '', to: '' }
              setFilters(reset)
              await load(reset)
            }}
          >
            Reset
          </button>
        </div>
      </form>

      {error && <p className="error-text">{error}</p>}
      {loading && <p>Loading audit events...</p>}

      {!loading && state.auditEntries.length === 0 && <p>No audit events found for this filter.</p>}

      {state.auditEntries.map((entry, idx) => (
        <article className="admin-card" key={`${entry.ts}-${entry.action}-${idx}`}>
          <p><strong>{entry.action}</strong> ({entry.outcome})</p>
          <p>{entry.ts}</p>
          <p>Actor: {entry.actorEmail || 'N/A'} | IP: {entry.ip || 'N/A'}</p>
          {entry.targetId && <p>Target: {entry.targetId}</p>}
          {entry.reason && <p>Reason: {entry.reason}</p>}
        </article>
      ))}
    </div>
  )
}

function AdminChatPage({ store }) {
  const { state, actions } = store
  const [selectedEmail, setSelectedEmail] = useState('')
  const [text, setText] = useState('')

  const users = [...new Set(state.chatMessages.map((m) => m.userEmail).filter(Boolean))]
  const activeUser = selectedEmail || users[0]
  const messages = state.chatMessages.filter((m) => m.userEmail === activeUser)

  return (
    <div>
      <h2>Chat Management</h2>
      <div className="chat-admin-grid">
        <aside className="admin-card">
          {users.map((u) => <button key={u} className="chat-user" onClick={() => setSelectedEmail(u)}>{u}</button>)}
          {users.length === 0 && <p>No chats yet.</p>}
        </aside>
        <div className="admin-card">
          <div className="chat-history">
            {messages.map((m) => <p key={m.id}><strong>{m.sender}:</strong> {m.text}</p>)}
          </div>
          {activeUser && (
            <div className="chat-compose">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply to customer" />
              <button
                className="btn btn-solid"
                onClick={async () => {
                  if (!text.trim()) {
                    return
                  }
                  await actions.sendChatMessage({ sender: 'admin', text: text.trim(), userEmail: activeUser })
                  setText('')
                }}
              >
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ChatWidget({ store }) {
  const { state, actions } = store
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const email = state.currentUser?.email || 'guest@sameria.local'
  const messages = state.chatMessages.filter((m) => m.userEmail === email)
  return (
    <div className="chat-widget">
      {open && (
        <div className="chat-box">
          <h4>Live Chat</h4>
          <div className="chat-history">
            {messages.map((m) => <p key={m.id}><strong>{m.sender}:</strong> {m.text}</p>)}
            {messages.length === 0 && <p>Start chatting with support.</p>}
          </div>
          <div className="chat-compose">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
            <button
              className="btn btn-solid"
              onClick={async () => {
                if (!text.trim()) {
                  return
                }
                await actions.sendChatMessage({ sender: 'user', text: text.trim(), userEmail: email })
                setText('')
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
      <button className="chat-fab" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Chat'}</button>
    </div>
  )
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <img className="footer-logo" src={`${import.meta.env.BASE_URL}sameria-logo.png`} alt="Sameria logo" />
          <h4>SAMERIA</h4>
          <p>Premium clothing brand in Bangladesh.</p>
        </div>
        <div>
          <h4>Contact</h4>
          <div className="footer-list">
            <div className="footer-item">
              <svg className="footer-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21s-6-5.2-6-11a6 6 0 1 1 12 0c0 5.8-6 11-6 11z" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
              <span>471/2 Barekvandari Road, Dewan city, Uttara, Dhaka</span>
            </div>
            <a className="footer-item" href="mailto:contact@sameria.bd">
              <svg className="footer-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 6h18v12H3z" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span>contact@sameria.bd</span>
            </a>
            <a className="footer-item" href="tel:+8801750814651">
              <svg className="footer-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6.8 3.6a2 2 0 0 1 2.2-.5l2 .8a2 2 0 0 1 1.2 1.8l.1 2a2 2 0 0 1-.6 1.5l-1.2 1.2a14.3 14.3 0 0 0 3.1 3.1l1.2-1.2a2 2 0 0 1 1.5-.6l2 .1a2 2 0 0 1 1.8 1.2l.8 2a2 2 0 0 1-.5 2.2l-1 1a3 3 0 0 1-2.5.8c-6.6-.8-11.8-6-12.6-12.6a3 3 0 0 1 .8-2.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>+880 1750 814651</span>
            </a>
          </div>
        </div>
        <div>
          <h4>Social</h4>
          <div className="footer-list">
            <a className="footer-item" href="https://www.instagram.com/sameria.fashion" target="_blank" rel="noreferrer">
              <svg className="footer-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="16.8" cy="7.2" r="1" fill="currentColor" />
              </svg>
              <span>Instagram</span>
            </a>
            <a className="footer-item" href="https://www.facebook.com/sameriafashion" target="_blank" rel="noreferrer">
              <svg className="footer-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 8h2V5.2c-.3 0-1.1-.2-2.2-.2-2.2 0-3.8 1.3-3.8 4V11H8v3h2v5h3v-5h2.5l.4-3H13v-1.7c0-.9.2-1.3 1-1.3z" fill="currentColor" />
              </svg>
              <span>Facebook</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default App

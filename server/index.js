import cors from 'cors'
import bcrypt from 'bcryptjs'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import { v4 as uuid } from 'uuid'
import { z } from 'zod'
import { defaultDiscount, seedCoupons, seedProducts } from './seed.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_FILE = path.join(__dirname, 'data', 'db.json')
const AUDIT_FILE = path.join(__dirname, 'data', 'audit.log')
const UPLOAD_DIR = path.join(__dirname, 'uploads')
const PORT = Number(process.env.PORT || 4000)
const JWT_SECRET = process.env.JWT_SECRET || 'sameria-dev-secret'
const CORS_ORIGINS_RAW = process.env.CORS_ORIGINS

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

if (!CORS_ORIGINS_RAW) {
  throw new Error('CORS_ORIGINS is required. Example: CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173')
}

const CORS_ORIGINS = CORS_ORIGINS_RAW
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)

if (!CORS_ORIGINS.length) {
  throw new Error('CORS_ORIGINS must contain at least one allowed origin.')
}

const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000
const AUTH_DELAY_BASE_MS = 1000
const AUTH_DELAY_MAX_MS = 10 * 60 * 1000
const authFailures = new Map()

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    credentials: true,
  },
})

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: CORS_ORIGINS, credentials: true }))
app.use(express.json({ limit: '100kb' }))

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please wait and retry.' },
})

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Chat rate limit exceeded. Slow down and retry.' },
})

app.use('/api', generalLimiter)
app.use('/api/auth', authLimiter)
app.use('/api/chat/messages', chatLimiter)
app.use('/api/uploads', express.static(UPLOAD_DIR))

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase()
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext || '.jpg'}`)
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed'))
      return
    }
    cb(null, true)
  },
})

const discountSchema = z.object({
  enabled: z.boolean(),
  type: z.enum(['percent', 'fixed']),
  value: z.number().min(0).max(100000),
})

const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  price: z.number().min(0).max(1000000),
  category: z.string().trim().min(2).max(60),
  sizes: z.array(z.string().trim().min(1).max(10)).min(1).max(20),
  colors: z.array(z.string().trim().min(1).max(30)).min(1).max(20),
  image: z.string().url(),
  description: z.string().trim().min(5).max(1000),
  rating: z.number().min(0).max(5),
  reviews: z.number().int().min(0).max(1000000),
  featured: z.boolean(),
  trending: z.boolean(),
  stock: z.number().int().min(0).max(1000000),
})

const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email().transform((x) => x.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  phone: z.string().trim().min(7).max(30),
})

const signinSchema = z.object({
  email: z.string().email().transform((x) => x.trim().toLowerCase()),
  password: z.string().min(1).max(128),
})

const cartItemSchema = z.object({
  id: z.string().optional(),
  productId: z.string().min(1).max(120),
  size: z.string().trim().min(1).max(20),
  quantity: z.number().int().min(1).max(999),
})

const couponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(20),
  type: z.enum(['percent', 'fixed']),
  value: z.number().min(0).max(100000),
  active: z.boolean(),
})

const orderCreateSchema = z.object({
  checkout: z.object({
    address: z.string().trim().min(5).max(300),
    phone: z.string().trim().min(7).max(30),
    paymentMethod: z.enum(['Cash on Delivery', 'bKash', 'Nagad', 'Card']),
  }),
  cart: z.array(cartItemSchema).min(1).max(200),
  activeCoupon: couponSchema.nullable().optional(),
})

const orderStatusSchema = z.object({
  status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']),
})

const userRoleSchema = z.object({
  role: z.enum(['customer', 'sales', 'admin']),
})

const stockUpdateSchema = z.object({
  stock: z.number().int().min(0).max(1000000),
})

const salesCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email().transform((x) => x.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  phone: z.string().trim().min(7).max(30),
})

const userAccessSchema = z.object({
  blocked: z.boolean(),
  reason: z.string().trim().max(200).optional(),
})

const userProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().email().transform((x) => x.trim().toLowerCase()).optional(),
  phone: z.string().trim().min(7).max(30).optional(),
})

const couponApplySchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(20),
})

const chatMessageSchema = z.object({
  sender: z.enum(['user', 'admin']),
  text: z.string().trim().min(1).max(500),
  userEmail: z.string().email().transform((x) => x.trim().toLowerCase()),
})

const chatQuerySchema = z.object({
  userEmail: z.string().email().transform((x) => x.trim().toLowerCase()).optional(),
})

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  action: z.string().trim().min(1).max(120).optional(),
  actorEmail: z.string().email().transform((x) => x.trim().toLowerCase()).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

function validate(schema, target = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[target])
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Validation failed',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    if (target === 'query') {
      req.validatedQuery = parsed.data
    } else {
      req[target] = parsed.data
    }
    next()
  }
}

function now() {
  return Date.now()
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  return req.ip || req.socket?.remoteAddress || 'unknown-ip'
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase()
}

function failureKey(email, ip) {
  return `${normalizeIdentity(email)}|${ip}`
}

function getOrCreateFailureEntry(key) {
  const existing = authFailures.get(key)
  const current = now()
  if (existing && current - existing.lastFailureAt <= AUTH_FAILURE_WINDOW_MS) {
    return existing
  }
  const fresh = { count: 0, lockedUntil: 0, lastFailureAt: 0 }
  authFailures.set(key, fresh)
  return fresh
}

function currentLockMs(key) {
  const entry = authFailures.get(key)
  if (!entry) {
    return 0
  }
  const remaining = entry.lockedUntil - now()
  if (remaining <= 0) {
    return 0
  }
  return remaining
}

function registerAuthFailure(key) {
  const entry = getOrCreateFailureEntry(key)
  entry.count += 1
  entry.lastFailureAt = now()
  const delayMs = Math.min(AUTH_DELAY_MAX_MS, AUTH_DELAY_BASE_MS * 2 ** Math.max(0, entry.count - 1))
  entry.lockedUntil = now() + delayMs
  return { attempts: entry.count, delayMs }
}

function clearAuthFailure(key) {
  authFailures.delete(key)
}

function auditLog(event) {
  try {
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`
    fs.appendFileSync(AUDIT_FILE, line, 'utf8')
  } catch (error) {
    console.error('audit-log-error', error)
  }
}

function readAuditEntries() {
  if (!fs.existsSync(AUDIT_FILE)) {
    return []
  }
  const raw = fs.readFileSync(AUDIT_FILE, 'utf8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function safeUser(user) {
  const { passwordHash, ...rest } = user
  return rest
}

function productPrice(db, product) {
  const pDiscount = db.productDiscounts[product.id]
  const discount = pDiscount?.enabled ? pDiscount : db.globalDiscount.enabled ? db.globalDiscount : null
  if (!discount) {
    return product.price
  }
  if (discount.type === 'percent') {
    return Math.max(0, Math.round(product.price * (1 - discount.value / 100)))
  }
  return Math.max(0, product.price - discount.value)
}

function computeTotals(db, cart, activeCoupon) {
  const items = cart
    .map((entry) => {
      const product = db.products.find((p) => p.id === entry.productId)
      if (!product) {
        return null
      }
      const unit = productPrice(db, product)
      return {
        id: entry.id || uuid(),
        productId: entry.productId,
        size: entry.size,
        quantity: Math.max(1, Number(entry.quantity || 1)),
        unit,
        line: unit * Math.max(1, Number(entry.quantity || 1)),
        product,
      }
    })
    .filter(Boolean)

  const subtotal = items.reduce((sum, item) => sum + item.line, 0)
  let couponDiscount = 0
  if (activeCoupon) {
    if (activeCoupon.type === 'percent') {
      couponDiscount = Math.round(subtotal * (activeCoupon.value / 100))
    } else {
      couponDiscount = Number(activeCoupon.value || 0)
    }
  }
  couponDiscount = Math.min(couponDiscount, subtotal)
  const shipping = subtotal > 5000 || subtotal === 0 ? 0 : 120
  const total = subtotal - couponDiscount + shipping
  return { items, subtotal, couponDiscount, shipping, total }
}

function applyDeliveredInventoryAdjustment(db, order) {
  if (!order || order.deliveryConfirmedAt) {
    return false
  }

  order.items.forEach((item) => {
    const product = db.products.find((p) => p.id === item.productId)
    if (!product) {
      return
    }
    product.stock = Math.max(0, product.stock - Number(item.quantity || 1))
  })

  order.deliveryConfirmedAt = Date.now()
  return true
}

function restoreDeliveredInventory(db, order) {
  if (!order || !order.deliveryConfirmedAt) {
    return false
  }

  order.items.forEach((item) => {
    const product = db.products.find((p) => p.id === item.productId)
    if (!product) {
      return
    }
    product.stock += Number(item.quantity || 1)
  })

  order.deliveryConfirmedAt = null
  return true
}

function readDb() {
  if (!fs.existsSync(DATA_FILE)) {
    return null
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8')
  return JSON.parse(raw)
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8')
}

function initDb() {
  const existing = readDb()
  if (existing) {
    return existing
  }
  const adminPasswordHash = bcrypt.hashSync('admin123', 10)
  const db = {
    users: [
      {
        id: 'u-admin',
        name: 'Sameria Admin',
        email: 'admin@sameria.com',
        phone: '+8801711111111',
        role: 'admin',
        isBlocked: false,
        passwordHash: adminPasswordHash,
      },
    ],
    products: seedProducts,
    orders: [],
    globalDiscount: defaultDiscount,
    productDiscounts: {},
    coupons: seedCoupons,
    chatMessages: [],
  }
  writeDb(db)
  return db
}

let db = initDb()

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
}

function getAuthUser(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) {
    return null
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    return db.users.find((u) => u.id === decoded.id) || null
  } catch {
    return null
  }
}

function requireAuth(req, res, next) {
  const user = getAuthUser(req)
  if (!user) {
    auditLog({
      action: 'auth.require',
      outcome: 'denied',
      reason: 'missing-or-invalid-token',
      ip: getClientIp(req),
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
    return res.status(401).json({ message: 'Unauthorized' })
  }
  if (user.isBlocked) {
    auditLog({
      action: 'auth.require',
      outcome: 'denied',
      reason: 'account-blocked',
      ip: getClientIp(req),
      method: req.method,
      path: req.path,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
    return res.status(403).json({ message: 'Account is blocked. Contact admin.' })
  }
  req.user = user
  next()
}

function requireAdmin(req, res, next) {
  const user = getAuthUser(req)
  if (!user || user.role !== 'admin') {
    auditLog({
      action: 'admin.guard',
      outcome: 'denied',
      ip: getClientIp(req),
      method: req.method,
      path: req.path,
      actorId: user?.id || null,
      actorEmail: user?.email || null,
      actorRole: user?.role || null,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
    return res.status(403).json({ message: 'Forbidden' })
  }
  req.user = user
  next()
}

function requireStaff(req, res, next) {
  const user = getAuthUser(req)
  if (!user || (user.role !== 'admin' && user.role !== 'sales')) {
    auditLog({
      action: 'staff.guard',
      outcome: 'denied',
      ip: getClientIp(req),
      method: req.method,
      path: req.path,
      actorId: user?.id || null,
      actorEmail: user?.email || null,
      actorRole: user?.role || null,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
    return res.status(403).json({ message: 'Forbidden' })
  }
  req.user = user
  next()
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/bootstrap', (req, res) => {
  const user = getAuthUser(req)
  const orders = user
    ? user.role === 'admin' || user.role === 'sales'
      ? db.orders
      : db.orders.filter((o) => o.userId === user.id)
    : []

  res.json({
    products: db.products,
    users: user?.role === 'admin' ? db.users.map(safeUser) : [],
    currentUser: user ? safeUser(user) : null,
    orders,
    globalDiscount: db.globalDiscount,
    productDiscounts: db.productDiscounts,
    coupons: db.coupons,
    chatMessages: user?.role === 'admin' ? db.chatMessages : user ? db.chatMessages.filter((m) => m.userEmail === user.email) : [],
  })
})

app.post('/api/auth/signup', validate(signupSchema), async (req, res) => {
  const { name, email, password, phone } = req.body
  const normalizedEmail = email
  if (db.users.some((u) => u.email === normalizedEmail)) {
    auditLog({
      action: 'auth.signup',
      outcome: 'rejected',
      reason: 'email-exists',
      ip: getClientIp(req),
      actorEmail: normalizedEmail,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
    return res.status(409).json({ message: 'Email already exists' })
  }
  const passwordHash = await bcrypt.hash(password, 10)
  const user = {
    id: `u-${Date.now()}`,
    name,
    email: normalizedEmail,
    phone,
    role: 'customer',
    isBlocked: false,
    passwordHash,
  }
  db.users.push(user)
  writeDb(db)
  const token = createToken(user)
  auditLog({
    action: 'auth.signup',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    userAgent: req.headers['user-agent'] || 'unknown',
  })
  res.status(201).json({ token, user: safeUser(user) })
})

app.post('/api/auth/signin', validate(signinSchema), async (req, res) => {
  const { email, password } = req.body
  const normalizedEmail = email
  const ip = getClientIp(req)
  const key = failureKey(normalizedEmail, ip)
  const lockMs = currentLockMs(key)

  if (lockMs > 0) {
    const retryAfterSec = Math.ceil(lockMs / 1000)
    res.setHeader('Retry-After', String(retryAfterSec))
    auditLog({
      action: 'auth.signin',
      outcome: 'blocked',
      reason: 'temporary-lockout',
      ip,
      actorEmail: normalizedEmail,
      retryAfterSec,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
    return res.status(429).json({ message: 'Too many failed attempts. Try again later.' })
  }

  const user = db.users.find((u) => u.email === normalizedEmail)
  if (!user) {
    const { delayMs, attempts } = registerAuthFailure(key)
    const retryAfterSec = Math.ceil(delayMs / 1000)
    res.setHeader('Retry-After', String(retryAfterSec))
    auditLog({
      action: 'auth.signin',
      outcome: 'rejected',
      reason: 'invalid-credentials',
      ip,
      actorEmail: normalizedEmail,
      attempts,
      retryAfterSec,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
    return res.status(401).json({ message: 'Invalid credentials' })
  }
  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    const { delayMs, attempts } = registerAuthFailure(key)
    const retryAfterSec = Math.ceil(delayMs / 1000)
    res.setHeader('Retry-After', String(retryAfterSec))
    auditLog({
      action: 'auth.signin',
      outcome: 'rejected',
      reason: 'invalid-credentials',
      ip,
      actorEmail: normalizedEmail,
      actorId: user.id,
      attempts,
      retryAfterSec,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
    return res.status(401).json({ message: 'Invalid credentials' })
  }
  if (user.isBlocked) {
    auditLog({
      action: 'auth.signin',
      outcome: 'blocked',
      reason: 'account-blocked',
      ip,
      actorEmail: normalizedEmail,
      actorId: user.id,
      actorRole: user.role,
      userAgent: req.headers['user-agent'] || 'unknown',
    })
    return res.status(403).json({ message: 'Your account is blocked. Please contact admin.' })
  }
  clearAuthFailure(key)
  const token = createToken(user)
  auditLog({
    action: 'auth.signin',
    outcome: 'success',
    ip,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    userAgent: req.headers['user-agent'] || 'unknown',
  })
  res.json({ token, user: safeUser(user) })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) })
})

app.get('/api/products', (_req, res) => {
  res.json({ products: db.products })
})

app.post('/api/products', requireAdmin, validate(productSchema), (req, res) => {
  const payload = req.body
  const product = { ...payload, id: `sam-${Date.now()}` }
  db.products.unshift(product)
  writeDb(db)
  auditLog({
    action: 'admin.product.create',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: product.id,
  })
  res.status(201).json({ product })
})

app.put('/api/products/:id', requireStaff, validate(productSchema), (req, res) => {
  const id = req.params.id
  const idx = db.products.findIndex((p) => p.id === id)
  if (idx === -1) {
    return res.status(404).json({ message: 'Product not found' })
  }
  db.products[idx] = { ...req.body, id }
  writeDb(db)
  auditLog({
    action: 'admin.product.update',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: id,
  })
  res.json({ product: db.products[idx] })
})

app.post('/api/products/upload-image', requireStaff, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'Invalid upload request' })
    }
    if (!req.file) {
      return res.status(400).json({ message: 'Image file is required' })
    }
    const url = `/api/uploads/${req.file.filename}`
    auditLog({
      action: 'staff.product.image.upload',
      outcome: 'success',
      ip: getClientIp(req),
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      targetId: req.file.filename,
    })
    return res.status(201).json({ url })
  })
})

app.patch('/api/products/:id/stock', requireStaff, validate(stockUpdateSchema), (req, res) => {
  const id = req.params.id
  const product = db.products.find((p) => p.id === id)
  if (!product) {
    return res.status(404).json({ message: 'Product not found' })
  }
  product.stock = req.body.stock
  writeDb(db)
  auditLog({
    action: 'staff.product.stock',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: id,
    meta: { stock: product.stock },
  })
  res.json({ product })
})

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  const id = req.params.id
  db.products = db.products.filter((p) => p.id !== id)
  writeDb(db)
  auditLog({
    action: 'admin.product.delete',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: id,
  })
  res.json({ ok: true })
})

app.get('/api/orders', requireAuth, (req, res) => {
  const orders = req.user.role === 'admin' || req.user.role === 'sales' ? db.orders : db.orders.filter((o) => o.userId === req.user.id)
  res.json({ orders })
})

app.post('/api/orders', requireAuth, validate(orderCreateSchema), (req, res) => {
  const { checkout, cart, activeCoupon } = req.body
  const totals = computeTotals(db, cart || [], activeCoupon || null)
  if (!totals.items.length) {
    return res.status(400).json({ message: 'Cart is empty' })
  }
  const order = {
    id: `ORD-${Date.now()}`,
    userId: req.user.id,
    userEmail: req.user.email,
    createdAt: Date.now(),
    status: 'pending',
    deliveryConfirmedAt: null,
    checkout,
    items: totals.items,
    totals,
  }
  db.orders.unshift(order)
  writeDb(db)
  auditLog({
    action: 'order.create',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: order.id,
  })
  res.status(201).json({ order })
})

app.patch('/api/orders/:id/status', requireStaff, validate(orderStatusSchema), (req, res) => {
  const id = req.params.id
  const { status } = req.body
  const order = db.orders.find((o) => o.id === id)
  if (!order) {
    return res.status(404).json({ message: 'Order not found' })
  }
  if (req.user.role === 'sales' && status !== 'delivered') {
    return res.status(403).json({ message: 'Sales users can only confirm delivered orders.' })
  }
  const previousStatus = order.status
  if (previousStatus === 'delivered' && status !== 'delivered') {
    restoreDeliveredInventory(db, order)
  }
  order.status = status
  let inventoryAdjusted = false
  if (status === 'delivered') {
    inventoryAdjusted = applyDeliveredInventoryAdjustment(db, order)
  }
  writeDb(db)
  auditLog({
    action: req.user.role === 'sales' ? 'sales.order.delivery.confirm' : 'admin.order.status',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: id,
    meta: { previousStatus, status, inventoryAdjusted },
  })
  res.json({ order })
})

app.get('/api/discounts', (_req, res) => {
  res.json({ globalDiscount: db.globalDiscount, productDiscounts: db.productDiscounts, coupons: db.coupons })
})

app.put('/api/discounts/global', requireAdmin, validate(discountSchema), (req, res) => {
  db.globalDiscount = req.body
  writeDb(db)
  auditLog({
    action: 'admin.discount.global',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
  })
  res.json({ globalDiscount: db.globalDiscount })
})

app.put('/api/discounts/product/:productId', requireAdmin, validate(discountSchema), (req, res) => {
  const productId = req.params.productId
  db.productDiscounts[productId] = req.body
  writeDb(db)
  auditLog({
    action: 'admin.discount.product',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: productId,
  })
  res.json({ productDiscounts: db.productDiscounts })
})

app.post('/api/coupons/apply', validate(couponApplySchema), (req, res) => {
  const { code } = req.body
  const coupon = db.coupons.find((c) => c.active && c.code === code)
  if (!coupon) {
    return res.status(404).json({ message: 'Invalid coupon' })
  }
  res.json({ coupon })
})

app.get('/api/users', requireAdmin, (_req, res) => {
  res.json({ users: db.users.map(safeUser) })
})

app.post('/api/admin/sales-accounts', requireAdmin, validate(salesCreateSchema), async (req, res) => {
  const { name, email, password, phone } = req.body
  if (db.users.some((u) => u.email === email)) {
    return res.status(409).json({ message: 'Email already exists' })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = {
    id: `u-${Date.now()}`,
    name,
    email,
    phone,
    role: 'sales',
    isBlocked: false,
    passwordHash,
  }
  db.users.push(user)
  writeDb(db)
  auditLog({
    action: 'admin.sales.create',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: user.id,
    meta: { email: user.email },
  })
  res.status(201).json({ user: safeUser(user), users: db.users.map(safeUser) })
})

app.patch('/api/users/:id/access', requireAdmin, validate(userAccessSchema), (req, res) => {
  const id = req.params.id
  const { blocked, reason } = req.body
  const user = db.users.find((u) => u.id === id)
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }
  if (user.role !== 'sales') {
    return res.status(400).json({ message: 'Access control is only allowed for sales team accounts.' })
  }
  user.isBlocked = blocked
  user.blockedReason = blocked ? reason || 'Blocked by admin' : ''
  user.blockedAt = blocked ? Date.now() : null
  writeDb(db)
  auditLog({
    action: blocked ? 'admin.sales.block' : 'admin.sales.unblock',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: user.id,
    meta: { reason: user.blockedReason || null },
  })
  res.json({ user: safeUser(user), users: db.users.map(safeUser) })
})

app.get('/api/admin/sales-activity', requireAdmin, (req, res) => {
  const salesUsers = db.users.filter((u) => u.role === 'sales')
  const salesEmailSet = new Set(salesUsers.map((u) => u.email))
  const salesIdSet = new Set(salesUsers.map((u) => u.id))

  const entries = readAuditEntries()
    .filter((entry) => {
      if (entry.actorRole === 'sales') {
        return true
      }
      if (entry.actorId && salesIdSet.has(entry.actorId)) {
        return true
      }
      if (entry.actorEmail && salesEmailSet.has(String(entry.actorEmail).toLowerCase())) {
        return true
      }
      return false
    })
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  const summary = salesUsers.map((user) => {
    const userEntries = entries.filter((e) => e.actorId === user.id || e.actorEmail === user.email)
    const lastActivity = userEntries[0]?.ts || null
    const rejectedCount = userEntries.filter((e) => e.outcome === 'rejected' || e.outcome === 'blocked').length
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      blocked: Boolean(user.isBlocked),
      lastActivity,
      activityCount: userEntries.length,
      rejectedCount,
    }
  })

  res.json({
    summary,
    entries: entries.slice(0, 150),
  })
})

app.patch('/api/users/:id/role', requireAdmin, validate(userRoleSchema), (req, res) => {
  const id = req.params.id
  const { role } = req.body
  const user = db.users.find((u) => u.id === id)
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }
  if (req.user.role === 'sales' && status !== 'delivered') {
    return res.status(403).json({ message: 'Sales users can only confirm delivered orders.' })
  }
  const previousStatus = order.status
  if (previousStatus === 'delivered' && status !== 'delivered') {
    restoreDeliveredInventory(db, order)
  }
  if (user.id === req.user.id && role !== 'admin') {
  let inventoryAdjusted = false
  if (status === 'delivered') {
    inventoryAdjusted = applyDeliveredInventoryAdjustment(db, order)
  }
    return res.status(400).json({ message: 'You cannot remove your own admin access.' })
  }
  user.role = role
  writeDb(db)
  auditLog({
    action: 'admin.user.role',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: id,
    meta: { role },
  })
  res.json({ user: safeUser(user), users: db.users.map(safeUser) })
})

app.patch('/api/users/:id', requireAuth, validate(userProfileSchema), (req, res) => {
  const id = req.params.id
  const { name, email, phone } = req.body
  
  // Users can only update their own profile
  if (req.user.id !== id) {
    return res.status(403).json({ message: 'You can only update your own profile.' })
  }
  
  const user = db.users.find((u) => u.id === id)
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }
  
  // Check if email is already taken by another user
  if (email && email !== user.email && db.users.some((u) => u.email === email)) {
    return res.status(400).json({ message: 'Email is already in use.' })
  }
  
  if (name) user.name = name
  if (email) user.email = email
  if (phone) user.phone = phone
  
  writeDb(db)
  auditLog({
    action: 'user.profile.update',
    outcome: 'success',
    ip: getClientIp(req),
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    targetId: id,
    meta: { fields: Object.keys(req.body).filter((k) => req.body[k]) },
  })
  res.json({ user: safeUser(user) })
})

app.get('/api/admin/audit', requireAdmin, validate(auditQuerySchema, 'query'), (req, res) => {
  const { limit = 100, action, actorEmail, from, to } = req.validatedQuery || req.query
  const fromTs = from ? new Date(from).getTime() : null
  const toTs = to ? new Date(to).getTime() : null

  const entries = readAuditEntries()
    .filter((entry) => (action ? entry.action === action : true))
    .filter((entry) => (actorEmail ? entry.actorEmail === actorEmail : true))
    .filter((entry) => {
      const ts = new Date(entry.ts).getTime()
      if (Number.isNaN(ts)) {
        return false
      }
      if (fromTs !== null && ts < fromTs) {
        return false
      }
      if (toTs !== null && ts > toTs) {
        return false
      }
      return true
    })
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, limit)

  res.json({ entries })
})

app.get('/api/chat/messages', requireAuth, validate(chatQuerySchema, 'query'), (req, res) => {
  const { userEmail } = req.validatedQuery || req.query
  if (req.user.role === 'admin') {
    if (userEmail) {
      return res.json({ messages: db.chatMessages.filter((m) => m.userEmail === userEmail) })
    }
    return res.json({ messages: db.chatMessages })
  }
  res.json({ messages: db.chatMessages.filter((m) => m.userEmail === req.user.email) })
})

app.post('/api/chat/messages', validate(chatMessageSchema), (req, res) => {
  const payload = req.body
  const message = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sender: payload.sender,
    text: payload.text,
    userEmail: payload.userEmail,
    createdAt: Date.now(),
  }
  db.chatMessages.push(message)
  writeDb(db)
  io.emit('chat:new', message)
  res.status(201).json({ message })
})

io.on('connection', (socket) => {
  socket.on('chat:send', (payload) => {
    const parsed = chatMessageSchema.safeParse(payload)
    if (!parsed.success) {
      return
    }
    const messagePayload = parsed.data
    const message = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender: messagePayload.sender,
      text: messagePayload.text,
      userEmail: messagePayload.userEmail,
      createdAt: Date.now(),
    }
    db.chatMessages.push(message)
    writeDb(db)
    io.emit('chat:new', message)
  })
})

httpServer.listen(PORT, () => {
  console.log(`SAMERIA backend running on http://localhost:${PORT}`)
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ message: 'Internal server error' })
})

import { z } from 'zod'

const signInSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const signUpSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  phone: z.string().trim().min(7, 'Phone must be at least 7 characters').max(30),
})

const checkoutSchema = z.object({
  address: z.string().trim().min(5, 'Address must be at least 5 characters').max(300),
  phone: z.string().trim().min(7, 'Phone must be at least 7 characters').max(30),
  paymentMethod: z.enum(['Cash on Delivery', 'bKash', 'Nagad', 'Card']),
})

const productFormSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  image: z.string().url('Image must be a valid URL'),
  description: z.string().trim().min(5).max(1000),
  price: z.coerce.number().min(0).max(1000000),
  stock: z.coerce.number().int().min(0).max(1000000),
  rating: z.coerce.number().min(0).max(5),
  reviews: z.coerce.number().int().min(0).max(1000000),
  sizes: z.string().trim().min(1, 'Provide at least one size'),
  colors: z.string().trim().min(1, 'Provide at least one color'),
})

export function validateSignInForm(values) {
  return signInSchema.safeParse(values)
}

export function validateSignUpForm(values) {
  return signUpSchema.safeParse(values)
}

export function validateCheckoutForm(values) {
  return checkoutSchema.safeParse(values)
}

export function validateProductForm(values) {
  return productFormSchema.safeParse(values)
}

export function firstIssueMessage(result, fallback) {
  if (result.success) {
    return ''
  }
  return result.error.issues[0]?.message || fallback
}

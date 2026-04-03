export const seedProducts = [
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
    stock: 24
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
    stock: 40
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
    stock: 18
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
    stock: 35
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
    stock: 26
  },
  {
    id: 'sam-006',
    name: 'Minimal Knit Polo',
    price: 1900,
    category: 'Knits',
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Ivory', 'Teal'],
    image: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=900&q=80',
    description: 'Fine gauge knit polo with subtle logo embroidery and soft collar.',
    rating: 4.4,
    reviews: 31,
    featured: false,
    trending: false,
    stock: 52
  }
]

export const seedCoupons = [
  { code: 'WELCOME10', type: 'percent', value: 10, active: true },
  { code: 'SAMERIA500', type: 'fixed', value: 500, active: true }
]

export const defaultDiscount = { enabled: false, type: 'percent', value: 0 }

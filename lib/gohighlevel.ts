// lib/gohighlevel.ts

const GHL_API_KEY = process.env.GHL_API_KEY!
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!
const GHL_BASE_URL = 'https://services.leadconnectorhq.com'

interface ContactData {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  tags?: string[]
  customFields?: Record<string, string>
}

interface GHLContact {
  id: string
  email: string
  firstName?: string
  lastName?: string
  tags?: string[]
}

async function ghlRequest(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${GHL_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('GHL API Error:', error)
    throw new Error(`GHL API Error: ${response.status} - ${error}`)
  }

  return response.json()
}

/**
 * Find a contact by email
 */
export async function findContactByEmail(email: string): Promise<GHLContact | null> {
  try {
    const data = await ghlRequest(
      `/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(email)}`
    )
    
    if (data.contacts && data.contacts.length > 0) {
      return data.contacts[0]
    }
    return null
  } catch (error) {
    console.error('Error finding contact:', error)
    return null
  }
}

/**
 * Create a new contact in GoHighLevel
 */
export async function createContact(contactData: ContactData): Promise<GHLContact | null> {
  try {
    const data = await ghlRequest('/contacts/', {
      method: 'POST',
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        email: contactData.email,
        firstName: contactData.firstName || '',
        lastName: contactData.lastName || '',
        phone: contactData.phone || '',
        tags: contactData.tags || [],
        source: 'BenchCoach App',
      }),
    })
    
    return data.contact
  } catch (error) {
    console.error('Error creating contact:', error)
    return null
  }
}

/**
 * Update an existing contact
 */
export async function updateContact(contactId: string, contactData: Partial<ContactData>): Promise<GHLContact | null> {
  try {
    const data = await ghlRequest(`/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...contactData,
      }),
    })
    
    return data.contact
  } catch (error) {
    console.error('Error updating contact:', error)
    return null
  }
}

/**
 * Add tags to a contact
 */
export async function addTagsToContact(contactId: string, tags: string[]): Promise<boolean> {
  try {
    await ghlRequest(`/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags }),
    })
    return true
  } catch (error) {
    console.error('Error adding tags:', error)
    return false
  }
}

/**
 * Remove tags from a contact
 */
export async function removeTagsFromContact(contactId: string, tags: string[]): Promise<boolean> {
  try {
    await ghlRequest(`/contacts/${contactId}/tags`, {
      method: 'DELETE',
      body: JSON.stringify({ tags }),
    })
    return true
  } catch (error) {
    console.error('Error removing tags:', error)
    return false
  }
}

/**
 * Create or update a contact (upsert)
 */
export async function upsertContact(contactData: ContactData): Promise<GHLContact | null> {
  // First, try to find existing contact
  const existing = await findContactByEmail(contactData.email)
  
  if (existing) {
    // Update existing contact and add new tags
    if (contactData.tags && contactData.tags.length > 0) {
      await addTagsToContact(existing.id, contactData.tags)
    }
    return existing
  } else {
    // Create new contact
    return createContact(contactData)
  }
}

// ============================================
// High-level event functions for BenchCoach
// ============================================

/**
 * Track when a user signs up (creates account)
 */
export async function trackSignup(email: string, firstName?: string, lastName?: string) {
  return upsertContact({
    email,
    firstName,
    lastName,
    tags: ['signup', 'benchcoach', 'lead'],
  })
}

/**
 * Track when a user starts a trial
 */
export async function trackTrialStarted(email: string) {
  const contact = await findContactByEmail(email)
  if (contact) {
    await removeTagsFromContact(contact.id, ['lead'])
    await addTagsToContact(contact.id, ['trial_started', 'trialing'])
  } else {
    await createContact({
      email,
      tags: ['trial_started', 'trialing', 'benchcoach'],
    })
  }
}

/**
 * Track when a user becomes a paying customer
 */
export async function trackCustomerCreated(email: string) {
  const contact = await findContactByEmail(email)
  if (contact) {
    await removeTagsFromContact(contact.id, ['lead', 'trialing', 'trial_started', 'churned'])
    await addTagsToContact(contact.id, ['customer', 'active'])
  } else {
    await createContact({
      email,
      tags: ['customer', 'active', 'benchcoach'],
    })
  }
}

/**
 * Track when a subscription is cancelled
 */
export async function trackSubscriptionCancelled(email: string) {
  const contact = await findContactByEmail(email)
  if (contact) {
    await removeTagsFromContact(contact.id, ['active', 'trialing'])
    await addTagsToContact(contact.id, ['churned', 'cancelled'])
  }
}

/**
 * Track when a payment fails
 */
export async function trackPaymentFailed(email: string) {
  const contact = await findContactByEmail(email)
  if (contact) {
    await addTagsToContact(contact.id, ['payment_failed'])
  }
}

/**
 * Track when payment is recovered after failure
 */
export async function trackPaymentRecovered(email: string) {
  const contact = await findContactByEmail(email)
  if (contact) {
    await removeTagsFromContact(contact.id, ['payment_failed'])
  }
}

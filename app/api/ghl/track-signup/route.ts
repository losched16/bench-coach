import { NextRequest, NextResponse } from 'next/server'
import { trackSignup } from '@/lib/gohighlevel'

export async function POST(request: NextRequest) {
  try {
    const { email, firstName, lastName } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Track signup in GoHighLevel
    const contact = await trackSignup(email, firstName, lastName)

    if (contact) {
      console.log(`📧 GHL: Signup tracked for ${email}`)
      return NextResponse.json({ success: true, contactId: contact.id })
    } else {
      console.error(`📧 GHL: Failed to track signup for ${email}`)
      return NextResponse.json({ success: false, error: 'Failed to create contact' }, { status: 500 })
    }
  } catch (error: any) {
    console.error('Error tracking signup:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

import { google } from 'googleapis'

export async function validateCouponCode(code: string) {
  try {
    // Check if configuration is present
    if (
      !process.env.GOOGLE_SHEETS_CLIENT_EMAIL ||
      !process.env.GOOGLE_SHEETS_PRIVATE_KEY ||
      !process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    ) {
      console.warn('Google Sheets configuration missing')
      return { 
        valid: false, 
        error: 'Configuration missing',
        details: 'Google Sheets credentials not set' 
      }
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })

    const sheets = google.sheets({ version: 'v4', auth })
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    
    // Assume codes are in "Sheet1!A:C" -> Code, DiscountType, Value
    // Example: "CODE10", "percentage", "10" 
    // or "FREE", "percentage", "100"
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:C', 
    })

    const rows = response.data.values
    
    if (!rows || rows.length === 0) {
      return { valid: false, error: 'No codes found' }
    }

    // Find the code (case insensitive)
    const discountRow = rows.find((row) => row[0]?.toString().trim().toUpperCase() === code.trim().toUpperCase())

    if (!discountRow) {
      return { valid: false, error: 'Invalid code' }
    }

    // Determine discount
    // Column B: Type (percentage, fixed)
    // Column C: Value (e.g., 100, 20)
    
    const type = discountRow[1]?.toLowerCase() || 'percentage'
    const value = parseFloat(discountRow[2] || '0')
    const isActive = discountRow[3] ? discountRow[3].toLowerCase() === 'true' : true // logic for active flag if needed, currently implied active if present

    // Basic validation on value
    if (isNaN(value)) {
       return { valid: false, error: 'Invalid discount configuration' }
    }

    return {
      valid: true,
      code: discountRow[0],
      type,
      value,
      isActive
    }

  } catch (error: any) {
    console.error('Error validating coupon:', error)
    return { valid: false, error: error.message }
  }
}

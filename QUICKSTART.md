# La Mirage WhatsApp Bot - Quick Start Guide

## \ud83d\ude80 Quick Start (5 minutes)

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Set Up Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

**Minimum required variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `VERTEX_PROJECT_ID` - Your Google Cloud project ID
- `VERTEX_KEY_FILE` - Path to Vertex AI service account key
- `ADMIN_WHITELIST` - Your WhatsApp number (without +)

### 3. Set Up Google Cloud

#### Vertex AI (Required for AI responses)
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable Vertex AI API
4. Create Service Account:
   - IAM & Admin → Service Accounts → Create
   - Grant role: "Vertex AI User"
   - Create key (JSON) → Save as `vertex_key.json`

#### Google Calendar (Optional for booking calendar)
1. Enable Google Calendar API
2. Create Service Account (or use same as above)
3. Grant role: "Calendar Editor"
4. Create key (JSON) → Save as `credentials.json`
5. Share your calendar with the service account email

### 4. Set Up PostgreSQL Database
```bash
# Install PostgreSQL (if not installed)
# Windows: Download from postgresql.org
# Mac: brew install postgresql
# Linux: sudo apt install postgresql

# Create database
createdb lamiragebeauty

# Update DATABASE_URL in .env
DATABASE_URL=postgresql://postgres:password@localhost:5432/lamiragebeauty
```

### 5. Run the Bot
```bash
python main.py
```

### 6. Scan QR Code
1. Bot will display a QR code in the terminal
2. Open WhatsApp on your phone
3. Go to: Settings → Linked Devices → Link a Device
4. Scan the QR code
5. Wait for "✅ WhatsApp bot ready!" message

## ✅ You're Done!

Send a message to your WhatsApp number to test the bot.

---

## 🔧 Troubleshooting

### "WhatsApp client not ready"
- Make sure you scanned the QR code
- Check that WhatsApp is open on your phone
- Try restarting the bot

### "Database connection failed"
- Verify PostgreSQL is running: `pg_isready`
- Check DATABASE_URL in .env
- Ensure database exists: `psql -l`

### "Vertex AI authentication failed"
- Verify `vertex_key.json` exists
- Check VERTEX_PROJECT_ID matches your Google Cloud project
- Ensure Vertex AI API is enabled

### "No QR code displayed"
- Install qrcode: `pip install qrcode[pil]`
- Check terminal supports Unicode characters
- Try running in a different terminal

---

## 📝 Next Steps

1. **Test the bot**: Send messages to verify all features work
2. **Add admin numbers**: Update ADMIN_WHITELIST in .env
3. **Customize salon info**: Update SALON_NAME, SALON_ADDRESS, etc.
4. **Review services**: Check SALON_DATA in main.py
5. **Set up production**: See README_PYTHON.md for deployment guide

---

## 🆘 Need Help?

- Check `README_PYTHON.md` for detailed documentation
- Review `walkthrough.md` for feature overview
- Check logs for error messages
- Ensure all dependencies are installed: `pip list`

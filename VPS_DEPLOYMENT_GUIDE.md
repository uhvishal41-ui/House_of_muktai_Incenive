# House of Muktai — VPS & GoDaddy Domain Deployment Guide (`houseofmuktai.co.in`)

- **Admin Panel (Desktop & Mobile):** `https://houseofmuktai.co.in`
- **Dedicated Employee Mobile App (PWA):** `https://staff.houseofmuktai.co.in`
- **Firebase Project:** `annular-anchor-qcxst`

---

## Step 1: GoDaddy DNS Setup (`houseofmuktai.co.in`)

1. GoDaddy account me login karein → **My Products → Domains → `houseofmuktai.co.in` → Manage DNS**.
2. Agar koi purana default/parked `A` record (`@`) ya `CNAME` (`www`) hai, toh usse edit ya delete karein.
3. Ye **3 `A` Records** add karein (apne VPS ka Public IPv4 address daalein, e.g. `123.45.67.89`):

| Type | Name / Host | Value (Points To) | TTL |
|------|-------------|-------------------|-----|
| `A` | `@` | `YOUR_VPS_IP` | `600 seconds` (or Default) |
| `A` | `www` | `YOUR_VPS_IP` | `600 seconds` (or Default) |
| `A` | `staff` | `YOUR_VPS_IP` | `600 seconds` (or Default) |

> DNS propagation 5–15 minutes me active ho jata hai. Verify karne ke liye local PC command prompt me run karein:
> `nslookup houseofmuktai.co.in` aur `nslookup staff.houseofmuktai.co.in`

---

## Step 2: Local PC se Project Code VPS par Upload karein

**Important:** Apne Local PC me `node_modules/` aur `dist/` folders upload mat karein (server par fresh build banayenge).

### Option A: Direct `scp` (Windows PowerShell / Mac Terminal se)
```bash
# 1. VPS par folder banayein (SSH karke)
ssh root@YOUR_VPS_IP "mkdir -p /var/www/house-of-muktai"

# 2. Local PC project folder ke andar se files upload karein (ZIP banakar upload karna sabse fast hai)
# Project folder ko ZIP karein (node_modules aur dist exclude karke) -> project.zip
scp project.zip root@YOUR_VPS_IP:/var/www/house-of-muktai/

# 3. VPS me login karke unzip karein
ssh root@YOUR_VPS_IP
cd /var/www/house-of-muktai
sudo apt update && sudo apt install -y unzip
unzip project.zip && rm project.zip
```

### Option B: Private GitHub Repository (Recommended for easy future updates)
```bash
ssh root@YOUR_VPS_IP
git clone https://github.com/YOUR_USERNAME/house-of-muktai.git /var/www/house-of-muktai
cd /var/www/house-of-muktai
```

---

## Step 3: VPS Server Par Node.js 22, PM2 & Nginx Install Karein (Ubuntu / Debian)

VPS terminal me SSH karke ye commands ek-ek karke chalayein:

```bash
# 1. System update aur essentials install karein
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx certbot python3-certbot-nginx ufw

# 2. Node.js 22 LTS install karein
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v22.x.x dikhna chahiye

# 3. PM2 global process manager install karein
sudo npm install -g pm2

# 4. Firewall open karein (SSH + HTTP + HTTPS)
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

---

## Step 4: Project Build & 24×7 Start (PM2)

```bash
cd /var/www/house-of-muktai

# 1. Production .env file banayein
cp .env.example .env

# 2. Dependencies install karein aur frontend build karein
npm install --include=dev
npm run build

# 3. PM2 ke saath app start karein (24x7 auto-restart)
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # Screen par jo command aaye, use copy-paste karke run karein

# 4. Local server health check karein
curl http://127.0.0.1:3000/api/v1/health
# Expected output: {"service":"house-of-muktai-incentive-api",...,"ok":true}
```

---

## Step 5: Nginx Domain Mapping + Free HTTPS SSL (Certbot)

```bash
# 1. Ready-made Nginx config copy aur enable karein
sudo cp /var/www/house-of-muktai/deploy/nginx-houseofmuktai.conf /etc/nginx/sites-available/houseofmuktai.co.in
sudo ln -sf /etc/nginx/sites-available/houseofmuktai.co.in /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 2. Nginx config test aur reload karein
sudo nginx -t
sudo systemctl reload nginx

# 3. Free Auto-Renewing HTTPS SSL Certificate install karein (teeno hostnames ke liye)
sudo certbot --nginx \
  -d houseofmuktai.co.in \
  -d www.houseofmuktai.co.in \
  -d staff.houseofmuktai.co.in
```

Certbot aapse email puchhega aur terms accept karne bolega. Complete hote hi teeno URLs automatically HTTPS (`https://`) par redirect ho jayenge aur har 90 din me auto-renew honge.

---

## Step 6: Firebase Authorized Domains Add Karein (Zaroori!)

1. **[Firebase Console](https://console.firebase.google.com/)** open karein → Project **`annular-anchor-qcxst`**.
2. **Authentication → Settings → Authorized domains** me jayein.
3. **Add domain** click karke ye teeno add karein:
   - `houseofmuktai.co.in`
   - `www.houseofmuktai.co.in`
   - `staff.houseofmuktai.co.in`

---

## Step 7: Final Global Verification (Desktop + Mobile)

1. **Desktop / Mobile Admin Panel:** Open `https://houseofmuktai.co.in`
   - Google Sign-In (`uhvishal41@gmail.com`) karein.
   - Sample Excel upload/export test karein.
   - **Copy Staff App Link** button click karein — automatically `https://staff.houseofmuktai.co.in` copy hoga.
2. **Employee Mobile App (Android & iOS):** Open `https://staff.houseofmuktai.co.in`
   - Direct Employee Login screen open hogi (Login ID + Password).
   - Browser menu / Install banner se **Add to Home Screen / Install App** karein — phone me **"Muktai Staff"** app icon ban jayega.
   - Admin se koi bhi incentive publish karte hi employee mobile par real-time turant dikhega.

---

## Optional: Future Code Update Karne Ke Liye (2 Commands)
```bash
cd /var/www/house-of-muktai
npm install --include=dev && npm run build
pm2 restart house-of-muktai-incentives
```

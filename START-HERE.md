# START HERE: Yaari (MERN), ek-ek step

Ye file sabse pehle padho. Isme 3 cheezein hain:
A. Laptop par chalana  |  B. GitHub par kaun si file kahan upload karni hai  |  C. Internet par live (Render)

## Zip ke andar kya hai (sirf 5 cheezein samajhni hain)

```
yaari-mern/
  START-HERE.md       <- ye file
  AUDIT-REPORT.md     <- kaun se bugs theek hue, tests ke asli result, kya bacha
  README.md           <- technical jaankari
  package.json        <- "npm run build" aur "npm start" yahin se chalte hain
  .gitignore          <- GitHub ko batata hai ki .env aur node_modules upload nahi karne
  server/             <- backend (Node + Express + MongoDB)
     .env.example     <- settings ka namuna (isse .env banate hain)
     src/             <- server ka poora code
     test/            <- tests
  client/             <- website (React)
     src/             <- website ka code
     public/config.js <- APNI BUSINESS DETAILS yahan bharo (naam, pata, email, phone)
```

## A. Apne laptop par chalao

1. **Node.js** (LTS) install karo: nodejs.org.
2. **MongoDB Atlas** (free database): mongodb.com/atlas par account, "Create" -> M0 Free -> Mumbai.
   - Database Access: ek user banao (username + password likh lo).
   - Network Access: "Allow Access From Anywhere".
   - Connect -> Drivers -> connection string copy karo. `<password>` ki jagah apna password, aur `.net/` ke baad `yaari` likho.
3. `yaari-mern/server/.env.example` ki copy banao, naam `.env`. Notepad se kholo aur bharo:
   MONGODB_URI, JWT_SECRET (40+ akshar random), APP_URL (`http://localhost:4000`), RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (test keys).
4. `yaari-mern` folder mein address bar mein `cmd` likho, Enter. Phir:
   ```
   npm run build
   npm start
   ```
   "Yaari running on port 4000" aaye to browser mein http://localhost:4000 kholo. Agar koi **[setup warning]** ya **[setup ERROR]** dikhe to usme likha hai ki kaunsi setting bharni hai.
5. Site par signup karo. Phir `yaari-mern/server` folder mein `cmd` kholo:
   ```
   npm run make-admin -- aapka-email@example.com
   ```
   Ab http://localhost:4000/admin par sign in karo.
6. **Apni business details bharo:** `client/public/config.js` (naam, pata, email, phone, grievance officer). Phir dobara `npm run build`.

## B. GitHub par kaun si file kahan upload karni hai

**Pehle ek baat:** GitHub par code rakhne ka matlab hai ki Render jaisi hosting usse utha sake. Secrets (passwords, keys) GitHub par **kabhi nahi** jaate.

**Upload KARNA hai (zip kholne ke baad `yaari-mern` folder ke andar ka sab kuch):**
- `package.json`, `README.md`, `START-HERE.md`, `AUDIT-REPORT.md`, `.gitignore`
- poora `server/` folder (usme `.env.example` hai, `.env` nahi)
- poora `client/` folder

**Upload NAHI karna hai:**
- `server/.env` (agar aapne banayi hai) <- sabse zaroori, isme aapke secrets hain
- `node_modules/` folders (agar `npm install` chalaya ho)
- `client/dist/` folder (agar `npm run build` chalaya ho)

**Kaise (laptop par, browser se):**
1. github.com par free account banao.
2. Upar `+` -> **New repository**. Naam: `yaari`. **Private** chuno. Create.
3. **uploading an existing file** link dabao.
4. `yaari-mern` folder ke **andar ka sab kuch** select karke (folder khud nahi, uske andar ki cheezein) drag karke GitHub page par chhod do. Folders (`server`, `client`) apne aap structure ke saath chadhte hain.
   - Agar `.gitignore` nahi dikhe (hidden file hoti hai), use alag se drag karo.
   - Ek baar mein ~100 files ki limit hoti hai. Zyada ho to 2 baar upload karo (pehle `server`, phir baaki).
5. Neeche **Commit changes** dabao.
6. Repository kholkar check karo: `.env` **nahi** dikhni chahiye. Dikhe to turant file delete karo aur MongoDB/Razorpay ke passwords badal do.

## C. Internet par live (Render)

1. render.com par account banao (GitHub se login).
2. **New -> Web Service** -> apna `yaari` repository chuno.
3. Settings:
   - Build Command: `npm run build`
   - Start Command: `npm start`
   - Environment Variables: `server/.env.example` ki saari values yahan daalo (`NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`, `APP_URL=https://aapki-site.onrender.com`, Razorpay keys, SMTP, ALERT_EMAIL ...). **Secrets yahin rehte hain, GitHub par nahi.**
4. Deploy. Pehli baar 5-10 minute lagte hain. Logs mein **[setup warning]** dhyan se padho.
5. Razorpay Dashboard -> Webhooks: URL `https://aapki-site.onrender.com/api/payments/webhook`, Secret = `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured` aur `order.paid`.
6. MongoDB Atlas -> Network Access mein Render ka access allow hona chahiye ("Allow from anywhere" kaam karta hai).
7. Render ka free plan so jata hai; asli users ke liye paid plan lo. MongoDB ke liye zaroor **Atlas** (booking ke transaction ke liye zaroori).
8. Admin ke liye: Render ke "Shell" ya apne laptop se (same MONGODB_URI ke saath) `npm run make-admin -- email` chalao.

## Tests chalana (jab chaho)

```
cd server
npm install
npm test                      # unit tests, 2 second mein, kuch install nahi chahiye
npm run test:integration      # MongoDB + (nakli) Razorpay ke saath poore flow; pehli baar mongod download karta hai
cd ../client
npm install
npm test                      # har screen draw hota hai ya nahi
```

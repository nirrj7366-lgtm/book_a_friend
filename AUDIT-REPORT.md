# Yaari (MERN): audit aur bug-fix report

**Seedha sach:** ye code **abhi "production ready" nahi hai.** Neeche likha hai ki kya asli mein chalaya gaya, kya sirf likha gaya (chalaya nahi), aur kya baaki hai.

---

## 1. Tests: asli results

### Jo yahan CHALAYE gaye (asli natije)
| Jaanch | Natija |
|---|---|
| Server unit tests (`cd server && npm test`): paisa/commission ka hisaab, booking clash ka rule, chat filter, file ka asli type, NoSQL injection safai, Razorpay signature (known-answer), refund ke niyam, 24-ghante auto-release, bina jawab wali booking ka refund, tareekh/umar/IST din, validators, setup checker | **20 tests, 20 pass, 0 fail** |
| Website render tests (`cd client && npm test`): har screen (home, signup, login, KYC, role, setup, account, renter, companion, admin, SOS sheet) draw hoti hai; har status ka label hai; **website jo API paths bulati hai wo server par maujood hain** | **8 tests, 8 pass, 0 fail** (ek temporary copy mein, jisme React installed tha) |
| Server ki sab 19 files load hoti hain, aur har `require` ka naam sach mein maujood hai | **19/19 load, 0 missing** |
| Syntax check: server + tests ki sab `.js` files, website + tests ki sab `.jsx/.js` files | **0 errors** |

### Jo likhe gaye par YAHAN CHALA NAHI SAKE (internet band, npm install nahi ho sakta)
**Integration tests: 46 tests** (`server/test/integration/`), jo asli MongoDB (replica set) aur ek **nakli Razorpay server** ke saath poore flow chalate hain:
- *auth_and_privacy* (14): signup/login, NoSQL injection, 8 galat password par lock, password badalne par purana token band, reset link ek baar, suspended user band, admin permission, **ID sirf owner aur admin dekh sake**, nakli `.jpg` refuse, extra fields se admin na ban sake, listing mein private data nahi.
- *booking_and_payment* (15): **5 log ek saath ek hi slot book karein to sirf 1 jeete**, overlap refuse / back-to-back allowed, photo/verified/service/venue/din ke niyam, server hi price tay kare, galat signature refuse, dusre ka payment confirm na ho, ek order ek hi baar, **browser verify + webhook + dobara webhook = ek hi payment record**, galat amount par auto-refund, cancel ki hui booking par late payment auto-refund, **3 baar ek saath refund = Razorpay ko 1 hi call**, refund fail hone par `refund_pending` aur retry, "already refunded" ko success maanna, check-in code 5 galat tries ke baad band.
- *wallet_and_safety* (17): commission (2 ghante x ₹250 -> companion ₹425, Yaari ₹100), **5 baar ek saath release = wallet mein ek hi baar paisa**, extra time ka paisa ek baar, nakli replay se double nahi, meeting khatam hone ke baad extra time refund, auto-release (aur problem report par nahi), bina jawab/unpaid timers, repair, **withdrawal double tap = ek hi**, reject = ek hi baar wapas, **SOS par asli email**, SOS retry, chat niyam, review ek hi, admin totals.

Chalane ke liye aapke computer par: `cd server && npm install && npm run test:integration` (pehli baar `mongod` download hota hai).
**In 46 tests ka koi natija maine nahi dekha. Pehli baar kuch fail ho sakte hain, jo mujhe bhej do.**

### Jo bilkul nahi chala
- **Asli Razorpay (test mode) ke saath payment**, UPI/card checkout, asli webhook.
- **Asli MongoDB Atlas** par transactions ka behaviour.
- `npm run build` (Vite) aur browser mein asli screens.
- Asli SMTP email, SMS gateway, browser notification.

---

## 2. Jo bugs theek kiye (file ke saath)

### Seedhe kaam na karne wale bugs
| # | Bug | Fix | Files |
|---|---|---|---|
| 1 | **Companion ka profile save hi nahi hota tha**: website `/companion` bulati thi, server `/companions` par sunta tha | Sahi address | `client/src/pages/Onboarding.jsx` |
| 2 | Chat har 4 second mein poori history mangta tha (zyada users par bhaari) | Sirf naye messages (`?after=`), index | `routes/bookings.js`, `client/src/Sheets.jsx`, `models.js` |
| 3 | Admin ka panel har render par kholi hui cheezein reset kar deta tha | Components ko functions ki tarah call kiya | `client/src/Admin.jsx` |

### Booking
| # | Bug | Fix | Files |
|---|---|---|---|
| 4 | Ek hi companion ki do booking ek hi samay par ho sakti thi (dono ek saath aate to) | **Transaction + companion par lock** (`lockSeq`); production mein bina transaction ke booking refuse | `routes/bookings.js`, `db.js`, `models.js` |
| 5 | Extra time bhi isi tarah clash kar sakta tha | Wahi lock | `routes/bookings.js` |
| 6 | Check-in code `Math.random` se banta tha aur 4 ank ko unlimited guess kar sakte the | `crypto.randomInt` + **sirf 5 galat tries** | `logic.js`, `routes/bookings.js`, `models.js` |
| 7 | Accept/booking par kam jaanch (past time, 120 din se aage, hours decimal, text ki jagah object) | Sakht validation | `routes/bookings.js` |
| 8 | Booking ke baad paisa/companion jawab na de to paisa **hamesha ke liye atak jata tha** | Timers: bina jawab wali paid booking aur kabhi shuru na hui meeting ka **auto-refund**; 24 ghante mein unpaid booking cancel | `services.js`, `cron.js` |

### Razorpay: payment, verification, refund
| # | Bug | Fix | Files |
|---|---|---|---|
| 9 | Har baar "Pay" dabane par **naya Razorpay order** banta tha; purane order ka payment booking se jud nahi pata tha (paisa liya, booking nahi) | Ek booking = ek order, wahi dobara use | `routes/bookings.js` |
| 10 | Cancel ki hui booking par ya galat amount ka payment aaye to **paisa rakh liya jata tha** | Aise "orphan" payment ka **automatic refund**; refund fail ho to admin ko email | `services.js` |
| 11 | Payment record pehle ya baad mein banne par crash ho to refund hi nahi ho pata | Pehle payment record (idempotent), phir booking | `services.js` |
| 12 | Refund aadha fail ho jaye to booking aur paisa **alag-alag haal** mein reh jate | `refund_pending` status, har payment ka alag "claim", retry ka button, "already refunded" ko success | `services.js`, `models.js`, `client/.../Renter.jsx`, `Admin.jsx` |
| 13 | Do ek saath refund click = double refund ka khatra | Payment ko `captured -> refunding` claim karke hi Razorpay bulate hain | `services.js` |
| 14 | Webhook kharab JSON par crash; amount ki jaanch nahi; Razorpay call par timeout nahi | Theek kiya (15 sec timeout, amount match) | `routes/payments.js`, `util.js` |
| 15 | Payment ids (order/payment) companion ko bhi list mein dikhte the | List se hata diye | `routes/bookings.js` |

### Wallet, commission, withdrawal
| # | Bug | Fix | Files |
|---|---|---|---|
| 16 | Wallet mein **ek booking ka paisa do baar judne** ka khatra (crash/parallel call) | Ek booking = ek hi earning (unique index `ref+type`), idempotent upsert, **repair timer** jo adhura kaam poora kare | `models.js`, `services.js` |
| 17 | **Double withdrawal**: do tap ek saath = dono paas, balance se zyada | **Ek person ka ek hi pending withdrawal** (unique index), pehle request phir debit, fail par undo | `models.js`, `routes/safety.js` |
| 18 | Reject par paisa **do baar wapas** ya kabhi nahi | Reversal ek hi baar (unique), crash ho to repair timer | `services.js`, `routes/admin.js` |
| 19 | Admin ke totals sirf pichle 1000 records se (galat) | Totals database se (`/admin/stats`) | `routes/admin.js`, `client/src/Admin.jsx` |

### Login aur security
| # | Bug | Fix | Files |
|---|---|---|---|
| 20 | Purane login token kabhi band nahi hote the (password badalne par bhi) | `tokenVersion`: password badalne/reset/suspend/erase par sab purane token band | `models.js`, `middleware.js`, `routes/auth.js`, `routes/me.js`, `routes/admin.js` |
| 21 | Suspended user API chala sakta tha | Sab jagah 403 (sirf `/auth/me` chhodkar) | `middleware.js` |
| 22 | Login par koi lock nahi; email hai ya nahi, ye time se pata chal jata tha | **8 galat par 15 minute lock**, har email par alag rate limit, nakli hash se same time | `routes/auth.js` |
| 23 | Password reset link do baar chal sakta tha (race) | Ek hi atomic step, session band | `routes/auth.js` |
| 24 | NoSQL injection (`{"$ne":null}`) ka khatra | `$` wali keys hata di, har input ka type check | `middleware.js`, `logic.js`, `index.js` |
| 25 | Upload ka type browser par bharosa karke maana jata tha (`.exe` ko `.jpg` naam) | **File ke asli bytes se type**, purani file hatana | `middleware.js`, `logic.js`, `routes/me.js`, `routes/companions.js` |
| 26 | **KYC ID**: dusre ko 403 milta tha (pata chalta tha file hai) | Dusre ko "not found"; ID par `no-store`, `nosniff`, sandbox; admin ka dekhna log hota hai | `routes/files.js` |
| 27 | 4 se zyada gallery photos (parallel upload) | Atomic limit | `routes/me.js` |
| 28 | Browser security policy (CSP) band thi | Default "report" (safe), `CSP_MODE=enforce` | `index.js`, `config.js` |
| 29 | Sensitive jagahon par rate limit nahi | Booking, pay-order, check-in code, chat, SOS, upload, withdraw, report | `routes/*.js` |
| 30 | Admin: apna status badal sakta, caretaker approval service hatane par bhi rehti | Roka / approval hatayi | `routes/admin.js`, `routes/companions.js` |

### SOS aur alerts
| # | Bug | Fix | Files |
|---|---|---|---|
| 31 | SOS sirf database mein save hota tha; **admin ko koi notification nahi** | **Asli email** (har admin + `ALERT_EMAIL`) + optional webhook (Slack/Discord/Telegram) + emergency contact ko SMS (aapke SMS gateway se); email fail ho to **har minute dobara koshish**; admin panel mein awaaz + browser notification + title | `notify.js`, `routes/safety.js`, `cron.js`, `client/src/Admin.jsx` |
| 32 | SOS spam, galat coordinates, dusre ki booking | Rate limit, range check, sirf apni booking | `routes/safety.js` |
| 33 | Report/problem par admin ko khabar nahi | Email alert | `routes/safety.js`, `routes/bookings.js` |

### Reviews, chat, password reset
- Review do baar (parallel) -> ek hi, saaf message; **rating ab har browse par aggregate nahi** (companion par jama rakhi) -> `models.js`, `routes/bookings.js`, `routes/companions.js`.
- Chat: sirf do log bhej sakte (admin nahi), speed limit, naye messages hi.
- Password reset: ek baar, 1 ghante, sab session band, `forgot` ka jawab same.

### Database, speed, API
- **Indexes** jode: booking (companion+status+time, renter, status+time), message, ledger, withdrawal (unique pending), alert, payment, review, block, user; location ping **60 din baad apne aap delete**. -> `models.js`.
- **Browse**: 12-12 karke ("Show more"), database mein hi filter + sort, private fields kabhi nahi (`$project`). -> `routes/companions.js`, `client/.../Renter.jsx`.
- **401 par apne aap logout** -> `client/src/api.js`, `App.jsx`.
- **Setup checker** (`preflight.js`): kamzor `JWT_SECRET`, adhuri `MONGODB_URI`, khali Razorpay/webhook/SMTP/ALERT_EMAIL, localhost URL, adhuri business details batata hai.

---

## 3. Placeholder / adhuri configuration jo aapko bharni hai

| Kahan | Kya bharna hai |
|---|---|
| `client/public/config.js` | **name, address, email, phone, grievanceOfficer** (Terms/Privacy/Refund/Contact pages par dikhte hain; abhi "YOUR ..." likha hai) |
| `server/.env` | `MONGODB_URI`, `JWT_SECRET`, `APP_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| `server/.env` (zaroori alerts ke liye) | `SMTP_*` aur `ALERT_EMAIL` (ya `ALERT_WEBHOOK_URL`) |
| `server/.env` (optional) | `SMS_WEBHOOK_URL` (+ token): emergency contact ko SMS |

Server shuru hote hi inme se jo kam hai wo **[setup warning]** / **[setup ERROR]** ke roop mein likh deta hai. Secrets sirf `.env` / Render ke Environment mein rehte hain, website ke code ya GitHub par nahi; sirf `RAZORPAY_KEY_ID` browser ko jati hai (wo public hoti hai).

**Dependencies:** server: express, mongoose, jsonwebtoken, bcryptjs, multer, helmet, express-rate-limit, node-cron, nodemailer, dotenv (+ test: mongodb-memory-server, supertest). Client: react, react-dom, vite, @vitejs/plugin-react (+ test: tsx). Node 18+.

---

## 4. Jo abhi BAAKI hai (sach)

1. **46 integration tests nahi chale** (upar). Asli Razorpay test-mode payment bhi nahi chala.
2. **Booking ka lock sirf MongoDB Atlas/replica set par kaam karta hai.** Laptop ke seedhe MongoDB par booking chalegi par do ek saath aaye to clash ho sakta hai. Production mein Atlas par hi chalao (production mein bina transaction ke booking refuse hoti hai).
3. **Admin 2-step verification, mobile OTP, selfie/face match: nahi hain.**
4. **SMS aur email asli tab hi jayenge jab aap SMTP/SMS gateway dein.** SMS wala hissa kisi bhi gateway ke saath maine **test nahi kiya** (bas ek simple webhook bhejta hai). Admin ka browser notification tabhi aata hai jab admin page khula ho; phone par push nahi.
5. **Razorpay ke refund ke baad ke events** (`refund.processed/failed`) handle nahi; refund Razorpay mein baad mein fail ho to pata nahi chalega. Payout abhi haath se (UPI), Razorpay Route/RazorpayX nahi.
6. **Photos/ID MongoDB ke andar** hain aur Node se serve hote hain: pilot ke liye theek, zyada users par S3/Cloudinary.
7. **Rate limiter har server instance mein alag** (kai instances chalane par Redis chahiye).
8. **Chat filter ko tod sakte hain** (jaise number ko shabdon mein likhna). Poora roka nahi ja sakta.
9. Free MongoDB (512 MB) photos ke saath jaldi bhar sakta hai.
10. Koi **professional security test, `npm audit`, ya code review nahi** hua. Launch se pehle karwao.
11. **Legal**: lawyer review, business registration, Razorpay live approval baaki.
12. Supabase wale test data ka naye database mein migration nahi hai.

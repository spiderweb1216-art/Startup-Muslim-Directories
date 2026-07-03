Startup Muslim Business Owner Approval System - Full Replacement Files

COPY STEPS:
1. Extract this zip.
2. Copy all folders/files into your project root:
   D:\Portals\Directories SM
3. Allow Windows to replace existing files.
4. Run locally:
   npm install
   npm start
5. Test these URLs:
   http://localhost:5000/register-business
   http://localhost:5000/login
   http://localhost:5000/dashboard
   http://localhost:5000/admin/approvals
   http://localhost:5000/admin/not-approved
6. Push and deploy:
   git add .
   git commit -m "Add complete business owner approval dashboard"
   git push
   Then redeploy on Hostinger.

IMPORTANT:
- User/business-owner login is /login
- Admin login stays /admin/login
- User-submitted businesses save as status=pending and do NOT show publicly.
- Edited user businesses go back to status=pending and do NOT show publicly until admin approval.
- Public website only shows status=published businesses.
- Admin can approve, not approve, edit, cancel delete request, or delete.
- Dashboard logo uses /uploads/sm-logo.webp.

If MySQL columns are missing, database.js creates business_users table and adds owner_user_id, admin_note, updated_at automatically on app startup.

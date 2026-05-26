import os
BASE = "/home/ubuntu/nq-backend/src/templates"
LOGO = "https://www.netqwix.com/assets/images/logo/netqwix_logo.png"

def t(title,hc,hi,ht,hs,body,cta,url="https://netqwix.com",cc="#000080"):
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>{title}</title>
<style>body{{margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;}}table{{border-collapse:collapse;}}img{{border:0;display:block;}}a{{text-decoration:none;}}@media(max-width:620px){{.w{{width:100%!important;}}.c{{padding:20px!important;}}.h{{padding:24px 20px!important;}}.btn{{display:block!important;width:100%!important;box-sizing:border-box!important;}}}}</style>
</head><body style="margin:0;padding:0;background:#f0f2f5;">
<div style="display:none;max-height:0;overflow:hidden;">{ht} — NetQwix</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table width="600" class="w" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:#000080;padding:16px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><a href="https://netqwix.com"><img src="{LOGO}" alt="NetQwix" height="40" style="height:40px;width:auto;"/></a></td>
    <td align="right"><a href="https://netqwix.com" style="color:rgba(255,255,255,0.65);font-size:12px;">Visit Site &rarr;</a></td>
  </tr></table>
</td></tr>
<tr><td style="background:{hc};padding:36px 40px 40px;text-align:center;" class="h">
  <div style="font-size:46px;line-height:1;margin-bottom:14px;">{hi}</div>
  <h1 style="margin:0 0 10px;color:#fff;font-size:26px;font-weight:700;line-height:1.25;">{ht}</h1>
  <p style="margin:0;color:rgba(255,255,255,0.82);font-size:15px;">{hs}</p>
</td></tr>
<tr><td style="padding:36px 40px;" class="c">{body}
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;"><tr><td align="center">
    <a href="{url}" class="btn" style="display:inline-block;background:{cc};color:#fff;font-size:16px;font-weight:700;padding:15px 44px;border-radius:8px;text-decoration:none;">{cta}</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #eef0f3;"/></td></tr>
<tr><td style="padding:24px 40px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding-bottom:14px;">
    <a href="https://netqwix.com"><img src="{LOGO}" alt="NetQwix" height="28" style="height:28px;width:auto;"/></a>
  </td></tr>
  <tr><td align="center" style="padding-bottom:14px;">
    <a href="https://facebook.com/netqwix" style="display:inline-block;width:30px;height:30px;background:#1877f2;border-radius:50%;line-height:30px;text-align:center;color:#fff;font-size:13px;font-weight:700;margin:0 4px;">f</a>
    <a href="https://twitter.com/netqwix" style="display:inline-block;width:30px;height:30px;background:#000;border-radius:50%;line-height:30px;text-align:center;color:#fff;font-size:13px;font-weight:700;margin:0 4px;">&#120143;</a>
    <a href="https://instagram.com/netqwix" style="display:inline-block;width:30px;height:30px;background:#e1306c;border-radius:50%;line-height:30px;text-align:center;color:#fff;font-size:13px;font-weight:700;margin:0 4px;">ig</a>
  </td></tr>
  <tr><td align="center" style="padding-bottom:10px;">
    <a href="https://netqwix.com/terms" style="color:#666;font-size:12px;margin:0 8px;">Terms of Use</a><span style="color:#ddd;">|</span>
    <a href="https://netqwix.com/privacy-policy" style="color:#666;font-size:12px;margin:0 8px;">Privacy Policy</a><span style="color:#ddd;">|</span>
    <a href="https://netqwix.com/unsubscribe" style="color:#666;font-size:12px;margin:0 8px;">Unsubscribe</a>
  </td></tr>
  <tr><td align="center"><p style="margin:0;color:#aaa;font-size:11px;">&copy; 2025 NetQwix.com &mdash; All rights reserved.</p></td></tr>
  </table>
</td></tr>
</table></td></tr></table></body></html>"""

def g(name): return f'<p style="color:#1a1a2e;font-size:16px;font-weight:600;margin:0 0 14px;">Hi {name},</p>'
def p(text): return f'<p style="color:#555;font-size:15px;line-height:1.75;margin:0 0 14px;">{text}</p>'
def tip(text): return f'<table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr><td style="background:#fffbeb;border-left:4px solid #FFD700;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;color:#555;">{text}</td></tr></table>'
def badge(bg,col,text): return f'<div style="display:inline-block;background:{bg};color:{col};font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px;margin-bottom:16px;">{text}</div><br/>'
def card(rows):
    rs="".join([f'<tr><td style="padding:10px 14px;border-bottom:1px solid #f0f2f5;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="width:28px;font-size:18px;">{r[0]}</td><td style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;width:70px;">{r[1]}</td><td style="color:#1a1a2e;font-size:14px;font-weight:600;">{r[2]}</td></tr></table></td></tr>' for r in rows])
    return f'<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9ff;border:1.5px solid #e0e5ff;border-radius:10px;margin:18px 0;overflow:hidden;">{rs}</table>'
def amount(val): return f'<table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr><td style="background:#000080;border-radius:10px;padding:20px;text-align:center;"><p style="margin:0 0 4px;color:rgba(255,255,255,0.7);font-size:11px;text-transform:uppercase;letter-spacing:1px;">Amount Paid</p><p style="margin:0;color:#FFD700;font-size:36px;font-weight:800;">{val}</p></td></tr></table>'

templates = {
"register.html":t("Welcome to NetQwix","#000080","👋","Welcome to NetQwix!","Your journey starts here",g("{NAME}")+badge("#dbeafe","#1e40af","🎉 Account Created")+p("We're thrilled to have you join the NetQwix community — where students connect with world-class experts for personalized online lessons.")+p("Complete your profile to get the most out of NetQwix.")+tip("💡 Add a profile photo and bio to get discovered faster."),"Complete My Profile","https://netqwix.com/dashboard"),
"trainee-welcome.html":t("Welcome Student — NetQwix","#000080","📚","Ready to learn?","Find your perfect expert today",g("{FULLNAME}")+badge("#dbeafe","#1e40af","🌟 Student Account Active")+p("Your NetQwix account is now active. Browse hundreds of verified experts across golf, fitness, music, languages, and more.")+p("Book your first session today and start learning from the best.")+tip("💡 First lesson free with select experts — look for the promo badge."),"Find an Expert","https://netqwix.com"),
"trainer-welcome.html":t("Welcome Expert — NetQwix","#000080","🎓","You're now a NetQwix Expert!","Start accepting bookings today",g("{FULLNAME}")+badge("#dbeafe","#1e40af","🏅 Expert Account Activated")+p("Your expert account is ready. Set up your availability, upload your intro video, and start getting booked by students worldwide.")+tip("💡 Experts with an intro video get 3× more bookings."),"Set Up My Profile","https://netqwix.com/dashboard"),
"session-confirmation.html":t("Session Confirmed — NetQwix","#16a34a","✅","Your session is confirmed!","Everything is set — see you there",g("{TRAINEE_NAME}")+badge("#dcfce7","#166534","✅ Session Confirmed")+p("Great news! Your lesson with <strong>{TRAINER_NAME}</strong> has been confirmed.")+card([("👤","Expert","{TRAINER_NAME}"),("📅","Date &amp; Time","{SESSION_TIME}"),("⏱️","Duration","[SESSION DURATION]")])+tip("💡 Test your camera and microphone 5 minutes before your session."),"Join Session","{MEETING_LINK}","#16a34a"),
"session-booking-trainer.html":t("New Booking — NetQwix","#000080","📬","You have a new booking!","A student wants to learn from you",g("{TRAINER_NAME}")+badge("#fef3c7","#92400e","🔔 New Booking Request")+p("{TRAINEE_NAME} has booked a session with you.")+card([("👤","Student","{TRAINEE_NAME}"),("📅","Date &amp; Time","{SESSION_TIME}"),("⏱️","Duration","[SESSION DURATION]")])+tip("💡 Confirm quickly — students appreciate fast responses."),"Confirm Booking","https://netqwix.com/dashboard"),
"session-booking-trainee.html":t("Booking Request Sent — NetQwix","#b45309","📤","Booking request sent!","Waiting for expert confirmation",g("{TRAINEE_NAME}")+badge("#fef3c7","#92400e","⏳ Awaiting Confirmation")+p("Your booking request with <strong>{TRAINER_NAME}</strong> has been sent.")+card([("👤","Expert","{TRAINER_NAME}"),("📅","Date &amp; Time","{SESSION_TIME}")])+tip("💡 Most experts respond within 2 hours."),"View My Bookings","https://netqwix.com/dashboard"),
"session-cancellation.html":t("Session Cancelled — NetQwix","#dc2626","😔","Session cancelled","We're sorry for the inconvenience",g("{FIRSTNAME}")+badge("#fee2e2","#991b1b","❌ Session Cancelled")+p("Your session has been cancelled. If a refund applies, it will be processed within 3–5 business days.")+tip("💡 Browse other available experts and rebook at your convenience."),"Find Another Expert","https://netqwix.com"),
"forgot_password.html":t("Reset Your Password — NetQwix","#b45309","🔑","Reset your password","This link expires in 24 hours",g("{USER_NAME}")+badge("#fef3c7","#92400e","🔒 Password Reset")+p("We received a request to reset your NetQwix password. This link expires in <strong>24 hours</strong>.")+p("If you didn't request this, you can safely ignore this email.")+tip("💡 Choose a strong password with letters, numbers, and symbols."),"Reset My Password","{REDIRECT_LINK}","#b45309"),
"before_meeting.html":t("Session Starting Soon — NetQwix","#7c3aed","⏰","Your session starts in 1 hour!","Get ready for your lesson",g("{FIRSTNAME}")+badge("#f3e8ff","#6b21a8","⏰ Starting Soon")+p("Your lesson with <strong>{TRAINER_NAME}</strong> is starting in 1 hour.")+card([("📅","Date &amp; Time","{SESSION_TIME}"),("📝","Note","{REMINDER_MESSAGE}")])+tip("💡 Check your internet connection and lighting before joining."),"Join Session","{MEETING_LINK}","#7c3aed"),
"5-min-remainder.html":t("Starting in 5 Minutes — NetQwix","#dc2626","⚡","5 minutes to go!","Your session is about to begin",g("{FIRSTNAME}")+badge("#fee2e2","#991b1b","🔴 Starting Now")+p("Your lesson with <strong>{TRAINER_NAME}</strong> starts in just <strong>5 minutes!</strong>"),"🎯 Join Now","{MEETING_LINK}","#16a34a"),
"meeting_confirmed.html":t("Expert Confirmed Your Session — NetQwix","#16a34a","🤜🤛","You're all set!","Expert confirmed your session",g("{TRAINEE_NAME}")+badge("#dcfce7","#166534","✅ Confirmed by Expert")+p("<strong>{TRAINER_NAME}</strong> has confirmed your session. Get ready for a great lesson!")+card([("📅","Date &amp; Time","{SESSION_TIME}"),("⏱️","Duration","[SESSION DURATION]")])+tip("💡 Save your meeting link — you'll need it to join."),"Add to Calendar 📅","{MEETING_LINK}","#16a34a"),
"meeting_ended.html":t("Great Session! — NetQwix","#000080","🏆","Great session!","Thanks for learning with NetQwix",g("{FIRSTNAME}")+badge("#dbeafe","#1e40af","🎊 Session Complete")+p("Your session with <strong>{TRAINER_NAME}</strong> has ended. We hope it was a great experience!")+p("Please take a moment to leave a review — it helps other students find great experts.")+tip("💡 Book your next session to keep your learning momentum going."),"Leave a Review ⭐","https://netqwix.com/dashboard","#b45309"),
"payment-confirmation.html":t("Payment Confirmed — NetQwix","#16a34a","💳","Payment confirmed!","Your transaction was successful",g("{FIRSTNAME}")+badge("#dcfce7","#166534","💳 Payment Successful")+p("We've received your payment. Here's your receipt for your records.")+amount("[AMOUNT]")+tip("💡 Keep this email as your payment confirmation receipt."),"View My Bookings","https://netqwix.com/dashboard","#16a34a"),
"verification-approved.html":t("Verification Approved — NetQwix","#16a34a","🎉","You're verified!","Your expert profile is now live",g("{TRAINER_NAME}")+badge("#dcfce7","#166534","✅ Verification Approved")+p("Your identity verification has been approved. Your profile is now fully visible to students and you can start receiving bookings.")+tip("💡 Share your NetQwix profile link on social media to attract more students."),"View My Profile","https://netqwix.com/dashboard","#16a34a"),
"verification-rejected.html":t("Verification Needs Attention — NetQwix","#dc2626","📋","Action required","Please resubmit your verification",g("{TRAINER_NAME}")+badge("#fee2e2","#991b1b","❌ Verification Unsuccessful")+p("Your identity verification wasn't approved. Please resubmit with the correct documents.")+tip("💡 Contact support@netqwix.com if you need help."),"Resubmit Documents","https://netqwix.com/dashboard","#b45309"),
"verification-submitted-user.html":t("Verification Submitted — NetQwix","#b45309","📄","Verification submitted!","We'll review within 24–48 hours",g("{TRAINER_NAME}")+badge("#fef3c7","#92400e","🔍 Under Review")+p("We've received your verification documents. Our team will review them within <strong>24–48 hours</strong>.")+tip("💡 You can still set up your profile and schedule while under review."),"Check My Status","https://netqwix.com/dashboard"),
"verification-submitted-admin.html":t("New Verification Submitted — Admin","#7c3aed","🔍","New verification submitted","Admin review required",g("Admin")+badge("#f3e8ff","#6b21a8","📋 New Submission")+p("A new expert verification has been submitted and requires review.")+card([("👤","Expert","{TRAINER_NAME}"),("📧","Account","{FULLNAME}")])+tip("💡 Please complete the review within 24 hours."),"Review Submission","https://netqwix.com/dashboard","#7c3aed"),
"clip-shared.html":t("New Clip Shared — NetQwix","#000080","🎬","New clip shared with you!","Watch your personalized coaching",g("{FIRSTNAME2}")+badge("#dbeafe","#1e40af","🎬 New Clip")+p("<strong>{FIRSTNAME1}</strong> has shared a training clip with you on NetQwix.")+tip("💡 Reply with your own clip to continue the coaching conversation."),"Watch Clip","{REDIRECT_LINK}"),
"clip-shared-new-user.html":t("A Clip Was Shared With You — NetQwix","#000080","🎬","Someone shared a clip with you!","Join NetQwix to watch it",g("there")+badge("#dbeafe","#1e40af","🎬 Clip Waiting")+p("<strong>{FIRSTNAME1}</strong> shared a training clip with you on NetQwix. Create a free account to watch it.")+tip("💡 NetQwix is free to join — start learning today."),"Watch Clip","{REDIRECT_LINK}"),
"friend-request.html":t("New Connection Request — NetQwix","#000080","👥","New connection request!","Grow your NetQwix network",g("{FIRSTNAME2}")+badge("#dbeafe","#1e40af","🤝 Connection Request")+p("<strong>{FIRSTNAME1}</strong> sent you a connection request on NetQwix."),"Accept Request","{REDIRECT_LINK}"),
"refer-expert.html":t("You've Been Invited to NetQwix","#b45309","🌐","Join NetQwix as an Expert!","Your friend thinks you'd be great",g("there")+badge("#fef3c7","#92400e","💌 Expert Invitation")+p("<strong>{FULLNAME1}</strong> thinks you'd be a perfect fit as an expert on NetQwix. Share your skills and earn money teaching what you love.")+tip("💡 Set your own rates and schedule on NetQwix."),"Join as an Expert","{REDIRECT_LINK}","#b45309"),
"refer-friend.html":t("Your Friend Invited You to NetQwix","#000080","🎁","You've been invited!","Join the NetQwix community",g("there")+badge("#dbeafe","#1e40af","💌 Friend Invitation")+p("<strong>{FULLNAME1}</strong> invited you to join NetQwix — connecting students with world-class experts for online lessons.")+tip("💡 Sign up free and get access to hundreds of verified experts."),"Accept Invitation","{REDIRECT_LINK}"),
"refer-trainee.html":t("Start Learning on NetQwix","#000080","🎓","Start learning today!","Your friend wants you on NetQwix",g("there")+badge("#dbeafe","#1e40af","📚 Student Invitation")+p("<strong>{FULLNAME1}</strong> thinks you'd love learning on NetQwix. Browse expert instructors across dozens of categories.")+tip("💡 New student discount available on your first booking."),"Start Learning","{REDIRECT_LINK}"),
"new-trainer.html":t("New Expert Alert — NetQwix","#000080","🎓","A new expert joined!","Check out their profile",g("{FIRSTNAME}")+badge("#dbeafe","#1e40af","🌟 New Expert")+p("A new expert matching your interests has joined NetQwix. Book a session while their calendar is open.")+tip("💡 New experts often offer introductory rates."),"View Expert Profile","https://netqwix.com"),
"new-trainee.html":t("New Student — NetQwix","#000080","👨‍🎓","You have a new student!","Say hello and get started",g("{TRAINER_NAME}")+badge("#dbeafe","#1e40af","🎓 New Student")+p("<strong>{TRAINEE_NAME}</strong> started following your profile. Invite them to book their first session.")+tip("💡 A quick welcome message can convert followers into paying students."),"View Student Profile","https://netqwix.com/dashboard"),
"trainee-join.html":t("Welcome to NetQwix","#000080","📚","Welcome aboard!","Your student account is ready",g("{FIRSTNAME}")+badge("#dbeafe","#1e40af","🌟 Account Ready")+p("Your NetQwix student account is set up. Browse experts and book your first lesson today.")+tip("💡 Save your favorite experts for quick access later."),"Find Experts Now","https://netqwix.com"),
"trainer-join.html":t("Welcome Expert — NetQwix","#000080","🎓","You're in!","Your expert account is ready",g("{FIRSTNAME}")+badge("#dbeafe","#1e40af","🏅 Expert Account Ready")+p("Your NetQwix expert account is activated. Complete your profile, set your availability, and start accepting bookings.")+tip("💡 Complete 100% of your profile to appear higher in search results."),"Complete My Profile","https://netqwix.com/dashboard"),
}

count=0
for fn,content in templates.items():
    with open(os.path.join(BASE,fn),'w') as f:
        f.write(content)
    count+=1
    print(f"✅ {fn}")
print(f"\nDone! {count}/27 templates written to {BASE}/")

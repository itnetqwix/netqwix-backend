#!/usr/bin/env python3
"""
NetQwix Email Template Generator
Generates 27 HTML email templates with modern NetQwix styling
and original content from the legacy templates.
"""
import os

BASE = "/home/ubuntu/nq-backend/src/templates"
LOGO = "https://www.netqwix.com/assets/images/logo/netqwix_logo%20real.png"
SITE = "https://netqwix.com"

def make_template(title, preheader, hero_color, hero_icon, hero_title, hero_sub, body_html, cta_text, cta_url, cta_color="#000080"):
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>{title}</title>
<style>body{{margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;}}table{{border-collapse:collapse;}}img{{border:0;display:block;}}a{{text-decoration:none;}}@media(max-width:620px){{.w{{width:100%!important;}}.c{{padding:20px!important;}}.h{{padding:24px 20px!important;}}.btn{{display:block!important;width:100%!important;box-sizing:border-box!important;}}}}</style>
</head><body style="margin:0;padding:0;background:#f0f2f5;">
<div style="display:none;max-height:0;overflow:hidden;">{preheader} — NetQwix</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table width="600" class="w" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:#ffffff;padding:16px 32px;border-bottom:2px solid #000080;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><a href="{SITE}"><img src="{LOGO}" alt="NetQwix" height="50" style="height:50px;width:auto;max-width:200px;"/></a></td>
    <td align="right"><a href="{SITE}" style="color:#000080;font-size:12px;">Visit Site &rarr;</a></td>
  </tr></table>
</td></tr>
<tr><td style="background:{hero_color};padding:36px 40px 40px;text-align:center;" class="h">
  <div style="font-size:46px;line-height:1;margin-bottom:14px;">{hero_icon}</div>
  <h1 style="margin:0 0 10px;color:#fff;font-size:26px;font-weight:700;line-height:1.25;">{hero_title}</h1>
  <p style="margin:0;color:rgba(255,255,255,0.82);font-size:15px;">{hero_sub}</p>
</td></tr>
<tr><td style="padding:36px 40px;" class="c">
{body_html}
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;"><tr><td align="center">
    <a href="{cta_url}" class="btn" style="display:inline-block;background:{cta_color};color:#fff;font-size:16px;font-weight:700;padding:15px 44px;border-radius:8px;">{cta_text}</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #eef0f3;margin:0"/></td></tr>
<tr><td style="padding:24px 40px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding-bottom:14px;"><a href="{SITE}"><img src="{LOGO}" alt="NetQwix" height="36" style="height:36px;width:auto;max-width:160px;"/></a></td></tr>
  <tr><td align="center" style="padding-bottom:14px;">
    <a href="https://facebook.com/netqwix" style="display:inline-block;width:30px;height:30px;background:#1877f2;border-radius:50%;line-height:30px;text-align:center;color:#fff;font-size:12px;font-weight:700;margin:0 4px;">f</a>
    <a href="https://twitter.com/netqwix" style="display:inline-block;width:30px;height:30px;background:#000;border-radius:50%;line-height:30px;text-align:center;color:#fff;font-size:12px;font-weight:700;margin:0 4px;">&#120143;</a>
    <a href="https://instagram.com/netqwix" style="display:inline-block;width:30px;height:30px;background:#e1306c;border-radius:50%;line-height:30px;text-align:center;color:#fff;font-size:12px;font-weight:700;margin:0 4px;">ig</a>
  </td></tr>
  <tr><td align="center" style="padding-bottom:10px;">
    <a href="{SITE}/terms" style="color:#666;font-size:12px;margin:0 8px;">Terms of Use</a><span style="color:#ddd;">|</span>
    <a href="{SITE}/privacy-policy" style="color:#666;font-size:12px;margin:0 8px;">Privacy Policy</a><span style="color:#ddd;">|</span>
    <a href="{SITE}/unsubscribe" style="color:#666;font-size:12px;margin:0 8px;">Unsubscribe</a>
  </td></tr>
  <tr><td align="center"><p style="margin:0;color:#aaa;font-size:11px;line-height:1.6;">&copy; 2026 NetQwix.com &mdash; All rights reserved.<br/>You are receiving this email because you have an account on NetQwix.</p></td></tr>
  </table>
</td></tr>
</table></td></tr></table>
</body></html>"""

def p(text, margin="0 0 14px"):
    return f'<p style="color:#555;font-size:15px;line-height:1.75;margin:{margin};">{text}</p>'

def badge(text, bg="#dbeafe", col="#1e40af"):
    return f'<div style="display:inline-block;background:{bg};color:{col};font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px;margin-bottom:18px;">{text}</div><br/>'

def tip(text):
    return f'<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="background:#fff8e1;border-left:4px solid #d4a000;padding:12px 18px;border-radius:0 8px 8px 0;"><p style="margin:0;font-size:13px;color:#555;line-height:1.6;">{text}</p></td></tr></table>'

def greeting(name):
    return f'<p style="color:#1a1a2e;font-size:16px;font-weight:600;margin:0 0 14px;">Hi {name},</p>'

def info_card(rows):
    rows_html = ""
    for icon, label, val in rows:
        rows_html += f'<tr><td style="padding:10px 14px;border-bottom:1px solid #f0f2f5;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="width:28px;font-size:18px;">{icon}</td><td style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;width:80px;">{label}</td><td style="color:#1a1a2e;font-size:14px;font-weight:600;">{val}</td></tr></table></td></tr>'
    return f'<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9ff;border:1.5px solid #e0e5ff;border-radius:10px;margin:18px 0;overflow:hidden;">{rows_html}</table>'

def section_title(text):
    return f'<p style="color:#000080;font-size:14px;font-weight:700;margin:16px 0 6px;">{text}</p>'

TEMPLATES = {

"register.html": make_template(
    "Welcome to NetQwix", "Welcome to NetQwix!",
    "#000080", "👋", "Welcome to NetQwix!", "Your journey starts here",
    greeting("{NAME}") +
    badge("🎉 Account Created") +
    p("We're excited to have you get started on NetQwix — the platform where passionate Experts and Enthusiasts meet LIVE for <strong>Qwick Sessions over the Net</strong>.") +
    p("You can now sign in and explore everything NetQwix has to offer.") +
    tip("💡 Complete your profile to start connecting with experts or students."),
    "Get Started", SITE, "#000080"
),

"trainee-welcome.html": make_template(
    "Welcome to NetQwix — Enthusiast", "Welcome to NetQwix!",
    "#000080", "🎓", "WELCOME to NETQWIX!", "Your learning journey begins now",
    greeting("{NAME}") +
    badge("🎉 Welcome, Enthusiast!") +
    p("Thank you for joining our community of passionate enthusiasts! NetQwix is here to modernize the way you learn and correspond with your favorite Subject Matter Experts worldwide — with Instant Gratification!") +
    section_title("📹 Upload Pre-Recorded Footage:") +
    p("You can upload and label video clips of pre-generated content for your expert to review with you live. Videos should be uploadable in any format.") +
    section_title("🔍 Searching for Experts:") +
    p("You can search for your favorite expert and request a Live Session.") +
    section_title("📅 Booking Sessions:") +
    p("Booking Live Sessions is easy on NetQwix! Select the video clips you'd like to go over. Live Sessions can be booked in advance or Experts can be booked for Live Instant Sessions by request — in which case NetQwix will contact your Expert for immediate confirmation.") +
    section_title("✅ Expert Confirmation:") +
    p("When the Expert accepts your Instant Session request, you are prompted to pay for the session and then you will be provided with a link to join the session directly.") +
    tip("💡 You can also call or text NetQwix support at <strong>212-829-8749</strong> if you have any questions or issues."),
    "Explore NetQwix", SITE + "/dashboard", "#000080"
),

"trainer-welcome.html": make_template(
    "Welcome to NetQwix — Expert", "Welcome to NetQwix!",
    "#000080", "🏆", "WELCOME to NETQWIX!", "Start teaching and earning today",
    greeting("{NAME}") +
    badge("🌟 Welcome, Expert!") +
    p("NetQwix is here to modernize the way you teach and correspond with customers worldwide, affectionately known as the NetQwix Enthusiast.") +
    section_title("💰 Setting your Session Fee:") +
    p("You earn <strong>80% of the session fee</strong>. Set your rate based on your expertise and experience.") +
    section_title("📅 Setting your NETQWIX Schedule:") +
    p("Click Schedule and then select the times you would like to be available each day. Use the repeat icon if you would like to make your schedule the same every day. Enthusiasts can request an Instant Session any time and we will alert you via text. Accept the Session via text and the link will bring you right into the session.") +
    section_title("✅ Confirming Sessions:") +
    p('Hit "Confirm" when you get NetQwix\'s Session Request and the enthusiast will be alerted.') +
    section_title("📹 Uploading Footage:") +
    p("You can upload video clips from your phone which can be referenced during the session using NetQwix's Clip Analysis Mode on the fly during the live session experience.") +
    section_title("⏱️ Ending the Session:") +
    p("The session ends when the timer concludes. NetQwix leaves 2 minutes of extra time for you to give last minute tips and plan for your next session.") +
    tip("💡 You can also call NetQwix support at <strong>212-829-8749</strong> if you have any questions or issues."),
    "Set Up My Profile", SITE + "/dashboard", "#000080"
),

"session-confirmation.html": make_template(
    "Session Confirmed — NetQwix", "Your session is confirmed!",
    "#16a34a", "✅", "NetQwix Training Session is Confirmed!", "You're all set — see you there",
    greeting("{TRAINEE_NAME}") +
    badge("✅ Session Confirmed", "#dcfce7", "#166534") +
    p("Your <strong>{SESSION_DURATION}</strong> NetQwix Training Session has been confirmed by <strong>{TRAINER_NAME}</strong> for <strong>{SESSION_TIME}</strong>.") +
    info_card([("👤", "Expert", "{TRAINER_NAME}"), ("📅", "Date &amp; Time", "{SESSION_TIME}"), ("⏱️", "Duration", "{SESSION_DURATION}")]) +
    tip("💡 Test your camera and microphone 5 minutes before the session begins."),
    "Join Session", "{MEETING_LINK}", "#16a34a"
),

"session-booking-trainer.html": make_template(
    "New Session Booking — NetQwix", "You have a new session booking!",
    "#000080", "📋", "NetQwix Training Session is Booked", "A student has booked a session with you",
    greeting("{TRAINER_NAME}") +
    badge("📋 New Booking", "#dbeafe", "#1e40af") +
    p("<strong>{TRAINEE_NAME}</strong> has booked a session with you. Your session has been booked for <strong>{SESSION_TIME}</strong>.") +
    info_card([("👤", "Student", "{TRAINEE_NAME}"), ("📅", "Date &amp; Time", "{SESSION_TIME}"), ("⏱️", "Duration", "{SESSION_DURATION}")]) +
    tip("💡 Please confirm this session promptly so your student can prepare."),
    "Confirm Now", "{REDIRECT_LINK}", "#000080"
),

"session-booking-trainee.html": make_template(
    "Session Booked — NetQwix", "Your session is booked!",
    "#000080", "📅", "NetQwix Training Session is Booked", "Thank you for booking",
    greeting("{TRAINEE_NAME}") +
    badge("📅 Session Booked", "#dbeafe", "#1e40af") +
    p("Thank you for booking your NetQwix Training Session with <strong>{TRAINER_NAME}</strong>. Your session has been booked for <strong>{SESSION_TIME}</strong>.") +
    p("Please wait for <strong>{TRAINER_NAME}</strong> to confirm your session. We'll notify you as soon as the session is confirmed.") +
    info_card([("👤", "Expert", "{TRAINER_NAME}"), ("📅", "Date &amp; Time", "{SESSION_TIME}"), ("⏱️", "Duration", "{SESSION_DURATION}")]) +
    tip("💡 You will receive another email once your expert confirms the session."),
    "View My Bookings", SITE + "/dashboard", "#000080"
),

"session-cancellation.html": make_template(
    "Session Cancelled — NetQwix", "Your session has been cancelled",
    "#dc2626", "❌", "NetQwix Training Session is Cancelled", "We're sorry for the inconvenience",
    greeting("{TRAINEE_NAME}") +
    badge("❌ Session Cancelled", "#fee2e2", "#991b1b") +
    p("Your <strong>{SESSION_DURATION}</strong> NetQwix Training Session has been Cancelled by <strong>{TRAINER_NAME}</strong> for <strong>{SESSION_TIME}</strong>. Payment refund has been initiated.") +
    tip("💡 Your refund will be processed within 3–5 business days. Book another slot with your expert or find a new one."),
    "Book Another Slot", SITE + "/dashboard", "#000080"
),

"forgot_password.html": make_template(
    "Reset Your Password — NetQwix", "Reset your password",
    "#d4a000", "🔑", "Reset your password", "This link expires in 24 hours",
    greeting("{USER_NAME}") +
    badge("🔒 Password Reset", "#fff8e1", "#7a5c00") +
    p("We received a request to reset your NetQwix password. Click the button below to create a new password. This link expires in <strong>24 hours</strong>.") +
    p("If you didn't request this password reset, you can safely ignore this email — your password won't change.") +
    tip("💡 Choose a strong password with a mix of letters, numbers, and symbols."),
    "Reset My Password", "{REDIRECT_LINK}", "#d4a000"
),

"before_meeting.html": make_template(
    "Your Session Starts Soon — NetQwix", "Your session is coming up",
    "#000080", "⏰", "Your session is coming up!", "Get ready to connect",
    greeting("{FIRSTNAME}") +
    badge("📅 Session Reminder", "#dbeafe", "#1e40af") +
    p("This is a reminder that your NetQwix Training Session with <strong>{TRAINER_NAME}</strong> is scheduled for <strong>{SESSION_TIME}</strong>.") +
    info_card([("👤", "Expert", "{TRAINER_NAME}"), ("📅", "Date &amp; Time", "{SESSION_TIME}"), ("⏱️", "Duration", "{SESSION_DURATION}")]) +
    tip("💡 Test your camera and microphone before the session. Make sure you have a stable internet connection."),
    "Join Session", "{MEETING_LINK}", "#16a34a"
),

"5-min-remainder.html": make_template(
    "5 Minutes to Go! — NetQwix", "Your session starts in 5 minutes",
    "#dc2626", "⚡", "5 minutes to go!", "Your session is about to begin",
    greeting("{FIRSTNAME}") +
    badge("🔴 Starting Now", "#fee2e2", "#991b1b") +
    p("Your NetQwix Training Session with <strong>{TRAINER_NAME}</strong> starts in just <strong>5 minutes</strong>! Please click the button below to join now.") +
    tip("💡 Make sure your camera and microphone are ready. Close any unnecessary applications."),
    "🎯 Join Session Now", "{MEETING_LINK}", "#16a34a"
),

"meeting_confirmed.html": make_template(
    "Session Confirmed — NetQwix", "Your session is confirmed!",
    "#16a34a", "🤜🤛", "Meeting Confirmed!", "Expert confirmed your session",
    greeting("{TRAINEE_NAME}") +
    badge("✅ Confirmed by Expert", "#dcfce7", "#166534") +
    p("<strong>{TRAINER_NAME}</strong> has confirmed your upcoming session. Get ready for a great lesson!") +
    info_card([("📅", "Date &amp; Time", "{SESSION_TIME}"), ("⏱️", "Duration", "{SESSION_DURATION}")]) +
    tip("💡 Save your meeting link — you'll need it to join the session."),
    "Add to Calendar 📅", "{MEETING_LINK}", "#16a34a"
),

"meeting_ended.html": make_template(
    "Great Session! — NetQwix", "Your session has ended",
    "#000080", "🏆", "Great session!", "Thanks for learning with NetQwix",
    greeting("{FIRSTNAME}") +
    badge("🎊 Session Complete", "#dbeafe", "#1e40af") +
    p("Your session with <strong>{TRAINER_NAME}</strong> has ended. We hope it was a great experience!") +
    p("Please take a moment to leave a review — it helps other students discover great experts and supports your expert's growth on the platform.") +
    tip("💡 Book your next session to keep your learning momentum going."),
    "Leave a Review ⭐", SITE + "/dashboard", "#d4a000"
),

"payment-confirmation.html": make_template(
    "Payment Confirmed — NetQwix", "Payment confirmed!",
    "#16a34a", "💳", "NetQwix Payment Confirmation", "Your transaction was successful",
    greeting("{FIRSTNAME}") +
    badge("💳 Payment Successful", "#dcfce7", "#166534") +
    p("We have received your payment of <strong>[AMOUNT]</strong> for your session with <strong>{TRAINER_NAME}</strong>.") +
    p("Please wait for <strong>{TRAINER_NAME}</strong> to confirm your session. We'll notify you as soon as the session is confirmed.") +
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="background:#000080;border-radius:10px;padding:20px 24px;text-align:center;"><p style="margin:0 0 4px;color:rgba(255,255,255,0.7);font-size:11px;text-transform:uppercase;letter-spacing:1px;">Amount Paid</p><p style="margin:0;color:#d4a000;font-size:36px;font-weight:800;">[AMOUNT]</p></td></tr></table>' +
    tip("💡 Keep this email as your payment confirmation receipt."),
    "View My Bookings", SITE + "/dashboard", "#16a34a"
),

"verification-approved.html": make_template(
    "You're Approved! — NetQwix", "Your expert account is approved",
    "#16a34a", "🎉", "You're approved!", "Welcome to the NetQwix Expert community",
    greeting("{TRAINER_NAME}") +
    badge("✅ Account Approved", "#dcfce7", "#166534") +
    p("Your NetQwix trainer account has been approved. You can now sign in and access the platform.") +
    p("Start setting up your schedule, set your session fee, and begin accepting bookings from students around the world.") +
    tip("💡 Complete 100% of your profile to get discovered faster by students."),
    "Go to NetQwix", SITE + "/dashboard", "#16a34a"
),

"verification-rejected.html": make_template(
    "Application Update — NetQwix", "Application update",
    "#dc2626", "📋", "Application update", "Additional information needed",
    greeting("{TRAINER_NAME}") +
    badge("⚠️ Review Required", "#fee2e2", "#991b1b") +
    p("We were unable to approve your trainer application at this time. This may be due to incomplete information or documentation that requires clarification.") +
    p("You may sign in to update your information and resubmit your application for review.") +
    tip("💡 Make sure all required fields are filled in completely before resubmitting."),
    "Update My Application", SITE + "/dashboard", "#dc2626"
),

"verification-submitted-user.html": make_template(
    "Application Received — NetQwix", "Application received",
    "#000080", "📝", "Application received!", "We're reviewing your submission",
    greeting("{TRAINER_NAME}") +
    badge("📋 Under Review", "#dbeafe", "#1e40af") +
    p("Thank you for completing your trainer verification steps. Our team will review your application within <strong>2–3 business days</strong>.") +
    p("You can check your application status by signing in at <a href='" + SITE + "' style='color:#000080;font-weight:600;'>netqwix.com</a>.") +
    tip("💡 We'll notify you by email as soon as your application has been reviewed."),
    "Check My Status", SITE + "/dashboard", "#000080"
),

"verification-submitted-admin.html": make_template(
    "Trainer Ready for Review — NetQwix", "New trainer verification submission",
    "#000080", "👤", "Trainer ready for review", "New verification submission received",
    '<p style="color:#1a1a2e;font-size:16px;font-weight:600;margin:0 0 14px;">Hi Admin,</p>' +
    badge("📋 New Submission", "#dbeafe", "#1e40af") +
    p("<strong>{TRAINER_NAME}</strong> has submitted their trainer verification and is ready for review.") +
    info_card([("👤", "Name", "{TRAINER_NAME}"), ("✉️", "Email", "{EMAIL}"), ("📱", "Phone", "{PHONE}")]) +
    tip("💡 Review the submission promptly to keep the trainer onboarding experience smooth."),
    "Open Verification Queue", SITE + "/admin", "#000080"
),

"clip-shared.html": make_template(
    "New Clip in Your Locker — NetQwix", "A new video is in your locker",
    "#000080", "🎬", "New clip in your locker!", "Your friend shared footage with you",
    greeting("{FIRSTNAME}") +
    badge("🎬 New Video Shared", "#dbeafe", "#1e40af") +
    p("Your friend <strong>{SHARER_NAME}</strong> has uploaded a video(s) in your NetQwix Locker! Head over to your locker to view the footage.") +
    tip("💡 You can review the footage together during your next live session using NetQwix Clip Analysis Mode."),
    "View Video(s)", SITE + "/dashboard", "#000080"
),

"clip-shared-new-user.html": make_template(
    "You're Invited to Join NetQwix!", "You've been invited to join NetQwix",
    "#000080", "🎬", "You're invited to join NetQwix!", "View your shared footage",
    '<p style="color:#1a1a2e;font-size:16px;font-weight:600;margin:0 0 14px;">Hi there,</p>' +
    badge("💌 You're Invited!", "#dbeafe", "#1e40af") +
    p("<strong>{SHARER_NAME}</strong> has invited you to join NetQwix — a new age interactive community where passionate Experts and Enthusiasts meet LIVE for <strong>\"Qwick Sessions over the Net\"</strong>.") +
    p("Your friend has shared video footage with you in a NetQwix Locker. Join now to view the video(s) and book a session with an expert.") +
    tip("💡 NetQwix is available via any smartphone, computer, or tablet with a webcam and reliable internet access."),
    "Join Now to View Video(s) &amp; Book Sessions", SITE + "/auth/signUp", "#000080"
),

"friend-request.html": make_template(
    "New Connection Request — NetQwix", "You have a friend request",
    "#000080", "👥", "NetQwix Friend Request", "Grow your NetQwix network",
    greeting("{FIRSTNAME2}") +
    badge("🤝 Friend Request", "#dbeafe", "#1e40af") +
    p("<strong>{FIRSTNAME1}</strong> has sent you a friend request on NetQwix. Accept to stay in touch, share training clips, and book sessions together.") +
    tip("💡 Growing your network helps you discover new learning opportunities and connect with experts."),
    "Accept Request", "{REDIRECT_LINK}", "#000080"
),

"refer-expert.html": make_template(
    "You're Invited to Join NetQwix as an Expert!", "Join NetQwix as an Expert",
    "#d4a000", "🌐", "Join NetQwix as an Expert!", "Your friend thinks you'd be great",
    '<p style="color:#1a1a2e;font-size:16px;font-weight:600;margin:0 0 14px;">Hi there,</p>' +
    badge("💌 Expert Invitation", "#fff8e1", "#7a5c00") +
    p("<strong>{FULLNAME1}</strong> has invited you to meet on NetQwix as an expert coach.") +
    p("NetQwix is a brand new teaching platform connecting Enthusiasts with highly qualified Experts like you for LIVE one-on-one training sessions conducted on NetQwix's customized LIVE interactive meeting platform.") +
    p("NetQwix is available via any smartphone, computer, or tablet with a webcam and reliable internet access.") +
    section_title("How it Works:") +
    p("1. Record a video or two while playing or practicing, and upload your videos in any format.<br/>2. Enthusiasts search for their favorite Expert and request a Training Session.<br/>3. Training Sessions can be booked in advance or Enthusiasts can request an instant lesson.<br/>4. Payment prompts NetQwix to provide a unique meeting link where you and the Enthusiast are connected inside NetQwix's custom Live Session portal.<br/>5. NetQwix's system enables you to diagram and analyze selected footage live while the Enthusiast watches and you discuss together.") +
    tip("💡 Top experts on NetQwix earn on their own schedule with full flexibility — you earn 80% of every session fee."),
    "Join as an Expert", "{REDIRECT_LINK}", "#d4a000"
),

"refer-friend.html": make_template(
    "You're Invited to Join NetQwix!", "Your friend invited you to NetQwix",
    "#000080", "🤝", "Your friend invited you to NetQwix!", "Start learning with the best experts",
    '<p style="color:#1a1a2e;font-size:16px;font-weight:600;margin:0 0 14px;">Hi there,</p>' +
    badge("💌 You're Invited!", "#dbeafe", "#1e40af") +
    p("<strong>{FULLNAME1}</strong> has invited you to join NetQwix.") +
    p("NetQwix is a brand new teaching platform connecting enthusiasts like you with highly qualified experts for LIVE one-on-one training sessions conducted on NetQwix's customized LIVE interactive meeting platform.") +
    p("NetQwix is available via any smartphone, computer, or tablet with a webcam and reliable internet access.") +
    section_title("How it Works:") +
    p("1. Record a video or two while playing or practicing.<br/>2. Join and upload your videos in any format.<br/>3. Search for an expert and request a Training Session.<br/>4. Training Sessions can be booked in advance or you can request an instant lesson — NetQwix will contact the Expert for immediate confirmation.<br/>5. Payment prompts NetQwix to provide a unique meeting link where you and the Expert are magically connected inside NetQwix's custom Live Session portal.<br/>6. NetQwix's system enables the Expert to diagram and analyze selected footage live while you watch and discuss. The system also uses the phone cam/webcam so your Expert can demonstrate and watch you implement changes together.<br/>7. Training Sessions and all uploaded footage are available for review in your personalized locker.<br/>8. A printable Game Plan reflecting the Training Session experience will be generated by your Expert and placed in your locker for future reference.") +
    tip("💡 In summary, you and your Expert will be able to train together easily and regularly using NetQwix. Contact us at 212-829-8749 to get started."),
    "Join NetQwix Now", "{REDIRECT_LINK}", "#000080"
),

"refer-trainee.html": make_template(
    "Welcome to NetQwix!", "Your friend invited you to NetQwix",
    "#000080", "🎓", "WELCOME to NETQWIX!", "Your friend referred you",
    '<p style="color:#1a1a2e;font-size:16px;font-weight:600;margin:0 0 14px;">Hi there,</p>' +
    badge("💌 You're Invited!", "#dbeafe", "#1e40af") +
    p("NetQwix is a brand new teaching platform connecting enthusiasts like you with highly qualified experts for LIVE one-on-one training sessions conducted on NetQwix's customized LIVE interactive meeting platform.") +
    p("NetQwix is available via any smartphone, computer, or tablet with a webcam and reliable internet access.") +
    section_title("NetQwix — How it Works:") +
    p("1. Expert or Enthusiast records swings while playing or practicing.<br/>2. Enthusiast joins NetQwix and uploads and labels video clips of pre-recorded footage in any format.<br/>3. Enthusiast searches for their favorite Expert and requests a session.<br/>4. Sessions can be booked in advance or Experts can be booked instantly — NetQwix will contact the Expert for immediate confirmation.<br/>5. When the Expert accepts the session, the Enthusiast is asked to purchase the lesson.<br/>6. Payment prompts NetQwix to provide a unique meeting link where the Expert and Enthusiast are magically connected inside NetQwix's custom Live Session portal.<br/>7. NetQwix's system enables the Expert to diagram and analyze selected footage live while the Enthusiast watches and they discuss.<br/>8. Sessions and all uploaded footage are available for review in your personalized locker.<br/>9. A printable Game Plan reflecting the Session experience will be generated by the Expert and placed in the Enthusiast's locker for future reference.") +
    tip("💡 Enthusiasts receive a Locker from which they can play uploaded swings, watch recordings of lessons, and view each Game Plan generated. Contact The NetQwix Team at 212-829-8749 to get started."),
    "Join NetQwix Now", "{REDIRECT_LINK}", "#000080"
),

"new-trainer.html": make_template(
    "New Expert Sign Up — NetQwix", "New expert joined NetQwix",
    "#000080", "🎓", "NetQwix New Expert Sign Up Request", "A new expert is waiting for approval",
    '<p style="color:#1a1a2e;font-size:16px;font-weight:600;margin:0 0 14px;">Hi Admin,</p>' +
    badge("🌟 New Expert", "#dbeafe", "#1e40af") +
    p("<strong>{TRAINER_NAME}</strong> has joined NetQwix as an Expert. {EMAIL_AND_NUMBER}") +
    p("Please review their profile and accept their request to get them started on the platform.") +
    tip("💡 New experts need approval before they can start accepting bookings from students."),
    "Accept Request", SITE + "/admin", "#000080"
),

"new-trainee.html": make_template(
    "New Enthusiast Joined — NetQwix", "New student joined NetQwix",
    "#000080", "👨‍🎓", "New NetQwix Enthusiast", "A new student has joined",
    '<p style="color:#1a1a2e;font-size:16px;font-weight:600;margin:0 0 14px;">Hi {TRAINER_NAME},</p>' +
    badge("🎓 New Student", "#dbeafe", "#1e40af") +
    p("<strong>{TRAINEE_NAME}</strong> has joined NetQwix as an Enthusiast. {EMAIL_AND_NUMBER}") +
    p("Reach out with a welcome message and invite them to book their first session with you.") +
    tip("💡 A quick welcome message can convert new students into paying clients."),
    "View Student Profile", SITE + "/dashboard", "#000080"
),

"trainee-join.html": make_template(
    "Welcome to NetQwix — Let's Get Started!", "Welcome to NetQwix!",
    "#000080", "🚀", "WELCOME to NETQWIX!", "Here's how to get started",
    greeting("{NAME}") +
    badge("🎉 Welcome, Enthusiast!") +
    p("Thank you for joining our community of passionate enthusiasts! NetQwix is here to modernize the way you learn and correspond with your favorite SME's worldwide — with Instant Gratification!") +
    p("Here are a few tips to guide you on getting started. You can also call NetQwix support at <strong>212-829-8749</strong> if you have any questions or issues.") +
    section_title("📹 Upload Pre-Recorded Footage:") +
    p("You can upload and label video clips of pre-generated content for your expert to review with you. Videos should be uploadable in any format.") +
    section_title("🔍 Searching for Experts:") +
    p("You can search for your favorite expert and request a Live Session.") +
    section_title("📅 Booking Sessions:") +
    p("Booking Live Sessions is easy on NetQwix! First, select the video clips you'd like to go over. Then, Live Sessions can be booked in advance or Experts can be booked for Live Instant Sessions by request — in which case NetQwix will contact your Expert for immediate confirmation.") +
    section_title("📤 Uploading Footage:") +
    p("You can upload pre-generated content which can be referenced during the session using NetQwix comparison mode on the fly during the live session experience.") +
    section_title("✅ Expert Confirmation:") +
    p("When the Expert accepts your Instant Session request, you are prompted to pay for the session and then you will be provided with a link to join the session directly.") +
    tip("💡 Yours in learning — The NetQwix Team"),
    "Start Exploring", SITE + "/dashboard", "#000080"
),

"trainer-join.html": make_template(
    "Welcome to NetQwix — Expert Guide", "Welcome to the NetQwix Expert team!",
    "#000080", "🏆", "WELCOME to NETQWIX!", "Your expert journey starts here",
    greeting("{NAME}") +
    badge("🌟 Welcome, Expert!") +
    p("Thank you for joining our team of experts! NetQwix is here to modernize the way you teach and correspond with new and existing customers.") +
    p("Here are a few tips to guide you on getting started. You can also call NetQwix support at <strong>212-829-8749</strong> if you have any questions or issues.") +
    section_title("💰 Setting your Session Fee:") +
    p("You earn <strong>80% of the session fee</strong>.") +
    section_title("📅 Setting your NETQWIX Schedule:") +
    p("Click Schedule and then select the times you would like to be available each day. Use the repeat icon if you would like to make your schedule the same every day. Enthusiasts can also request an Instant Session at any time and we will alert you via text. If you are available, you can accept the Session via text and the link will bring you right into the session.") +
    section_title("✅ Confirming Sessions:") +
    p('To confirm your sessions, hit "Confirm" when you receive NetQwix\'s Session Request text or email.') +
    section_title("📹 Uploading Footage:") +
    p("You can upload pre-generated content which can be referenced during the session using NetQwix comparison mode on the fly during the live session experience.") +
    section_title("⏱️ Ending the Session:") +
    p("The session ends when the timer concludes. NetQwix leaves 2 minutes of extra time for you to give last minute tips and plan for your next session.") +
    tip("💡 The NetQwix Team is always here to help — call us at 212-829-8749."),
    "Set Up My Schedule", SITE + "/dashboard", "#000080"
),

}

os.makedirs(BASE, exist_ok=True)
count = 0
for fname, html in TEMPLATES.items():
    path = os.path.join(BASE, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✅ {fname}")
    count += 1

print(f"\nDone! {count}/{len(TEMPLATES)} templates written to {BASE}/")

/** Default FAQ bundle — matches mobile `faqContent.ts` for one-click admin seed. */
export const DEFAULT_MOBILE_FAQ_SECTIONS = [
  {
    title: "Getting started",
    sort_order: 0,
    items: [
      {
        question: "What is NetQwix?",
        answer:
          "NetQwix connects trainees with expert coaches for live video lessons, clip review, scheduling, and progress tracking — all in one app.",
        sort_order: 0,
      },
      {
        question: "Do I need Expo Go for video lessons?",
        answer:
          "No. Live lessons require the NetQwix dev or store build with native WebRTC. Expo Go cannot run in-app video calls.",
        sort_order: 1,
      },
      {
        question: "How do I book a coach?",
        answer:
          "Use Book a lesson to pick a trainer, choose instant or scheduled time, attach clips if needed, and confirm payment.",
        sort_order: 2,
      },
    ],
  },
  {
    title: "Instant lessons",
    sort_order: 1,
    items: [
      {
        question: "How does an instant lesson work?",
        answer:
          "The trainee requests a lesson; the coach Accepts; both tap Join now within 2 minutes to enter the native meeting room.",
        sort_order: 0,
      },
      {
        question: "Why is Join disabled?",
        answer:
          "Join opens only after the coach accepts and while you are inside the 2-minute join window. Refresh Upcoming sessions if the booking just confirmed.",
        sort_order: 1,
      },
      {
        question: "When does the lesson timer start?",
        answer:
          "For instant lessons the timer starts automatically once both coach and trainee are in the call.",
        sort_order: 2,
      },
    ],
  },
  {
    title: "Scheduled sessions",
    sort_order: 2,
    items: [
      {
        question: "When can I join a scheduled session?",
        answer:
          "Join is enabled from 15 minutes before the session start time until the session ends (after the coach confirms the booking).",
        sort_order: 0,
      },
      {
        question: "Who starts the timer?",
        answer:
          "The coach taps Start after both are connected. If the trainee joins more than 2 minutes after the coach, the timer may start automatically.",
        sort_order: 1,
      },
      {
        question: "What if my coach is late?",
        answer:
          "The timer waits until both parties are in the call. You will see a banner when your partner joins.",
        sort_order: 2,
      },
    ],
  },
  {
    title: "Video & clips",
    sort_order: 3,
    items: [
      {
        question: "Why is my video black?",
        answer:
          "Allow camera and microphone in Settings, use a physical device (not simulator-only), and ensure your partner joined the same session.",
        sort_order: 0,
      },
      {
        question: "How do clips work in a lesson?",
        answer:
          "The coach selects clips from the locker; playback syncs to the trainee. Use the clips button on the compact toolbar during the call.",
        sort_order: 1,
      },
      {
        question: "Can I draw on video?",
        answer:
          "Coaches can enable draw mode and use shapes. Screenshots save to the session game plan.",
        sort_order: 2,
      },
    ],
  },
  {
    title: "Payments & wallet",
    sort_order: 4,
    items: [
      {
        question: "How do I pay for a lesson?",
        answer:
          "Payments run through Stripe when you book. Your wallet balance may apply per your account settings.",
        sort_order: 0,
      },
      {
        question: "How do coaches get paid?",
        answer:
          "Coaches connect Stripe in settings. Earnings follow the platform payout schedule after completed sessions.",
        sort_order: 1,
      },
    ],
  },
  {
    title: "Locker & game plans",
    sort_order: 5,
    items: [
      {
        question: "Where are my clips stored?",
        answer:
          "Trainees upload clips to My locker; coaches see trainee clips when attached to bookings or via clip picker in-call.",
        sort_order: 0,
      },
      {
        question: "What is a game plan?",
        answer:
          "After a lesson the coach can save screenshots and notes as a game plan PDF in the locker for later review.",
        sort_order: 1,
      },
    ],
  },
  {
    title: "Chat",
    sort_order: 6,
    items: [
      {
        question: "Can I edit or delete messages?",
        answer:
          "You can edit your message within 30 minutes, reply to a specific message, archive a chat, or delete a conversation from the chats list.",
        sort_order: 0,
      },
      {
        question: "How do groups work?",
        answer:
          "Create a group with friends from your circle. Invited members must accept before joining. The creator is the group admin.",
        sort_order: 1,
      },
    ],
  },
  {
    title: "Account & support",
    sort_order: 7,
    items: [
      {
        question: "How do I verify my account?",
        answer:
          "Complete profile, contact verification, and trainer verification steps under Settings when prompted.",
        sort_order: 0,
      },
      {
        question: "How do I contact support?",
        answer:
          "Use Contact us in Settings for technical issues or refunds, or ask a question at the bottom of the FAQ screen.",
        sort_order: 1,
      },
    ],
  },
] as const;

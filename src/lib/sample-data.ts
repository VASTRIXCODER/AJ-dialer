import type {
  ActiveCall,
  Appointment,
  Callback,
  CallRecord,
  Campaign,
  KpiPoint,
  Lead,
  MetricSummary,
  OutcomeOption,
  Rep,
} from "./types";

// Stable "now" anchor so server and client render the same relative times.
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

export const reps: Rep[] = [
  {
    id: "rep-1", name: "Maya Rodriguez", email: "maya@aiatwork.io", avatarColor: "#3B82F6",
    initials: "MR", role: "rep", status: "on_call", team: "Sunset Squad",
    callsToday: 142, conversationsToday: 38, appointmentsToday: 9, talkTimeMin: 184,
    connectRate: 31, score: 97, currentLeadId: "lead-1", callStartedAt: minsAgo(3),
  },
  {
    id: "rep-2", name: "James Carter", email: "james@aiatwork.io", avatarColor: "#0EA5E9",
    initials: "JC", role: "rep", status: "on_call", team: "Sunset Squad",
    callsToday: 128, conversationsToday: 34, appointmentsToday: 7, talkTimeMin: 165,
    connectRate: 29, score: 91, currentLeadId: "lead-2", callStartedAt: minsAgo(1),
  },
  {
    id: "rep-3", name: "Priya Nair", email: "priya@aiatwork.io", avatarColor: "#8B5CF6",
    initials: "PN", role: "rep", status: "available", team: "Solar Closers",
    callsToday: 119, conversationsToday: 31, appointmentsToday: 8, talkTimeMin: 158,
    connectRate: 30, score: 89,
  },
  {
    id: "rep-4", name: "Devon Brooks", email: "devon@aiatwork.io", avatarColor: "#10B981",
    initials: "DB", role: "rep", status: "wrap_up", team: "Solar Closers",
    callsToday: 134, conversationsToday: 29, appointmentsToday: 6, talkTimeMin: 171,
    connectRate: 26, score: 84,
  },
  {
    id: "rep-5", name: "Aisha Khan", email: "aisha@aiatwork.io", avatarColor: "#EC4899",
    initials: "AK", role: "rep", status: "on_call", team: "Sunset Squad",
    callsToday: 156, conversationsToday: 41, appointmentsToday: 10, talkTimeMin: 198,
    connectRate: 33, score: 99, currentLeadId: "lead-3", callStartedAt: minsAgo(6),
  },
  {
    id: "rep-6", name: "Tyler Nguyen", email: "tyler@aiatwork.io", avatarColor: "#F59E0B",
    initials: "TN", role: "rep", status: "break", team: "Solar Closers",
    callsToday: 98, conversationsToday: 22, appointmentsToday: 4, talkTimeMin: 121,
    connectRate: 24, score: 76,
  },
  {
    id: "rep-7", name: "Sofia Russo", email: "sofia@aiatwork.io", avatarColor: "#06B6D4",
    initials: "SR", role: "rep", status: "available", team: "Sunset Squad",
    callsToday: 111, conversationsToday: 27, appointmentsToday: 5, talkTimeMin: 143,
    connectRate: 25, score: 81,
  },
  {
    id: "rep-8", name: "Marcus Lee", email: "marcus@aiatwork.io", avatarColor: "#EF4444",
    initials: "ML", role: "rep", status: "offline", team: "Solar Closers",
    callsToday: 87, conversationsToday: 19, appointmentsToday: 3, talkTimeMin: 102,
    connectRate: 22, score: 71,
  },
];

export const currentRep = reps[0];

export const campaigns: Campaign[] = [
  {
    id: "camp-1", name: "PG&E True-Up Recovery", utilityProvider: "PG&E", status: "active",
    totalLeads: 4820, activeLeads: 1840, completedLeads: 2980, appointments: 412,
    contactRate: 34, color: "#3B82F6", startedAt: daysAgo(28),
  },
  {
    id: "camp-2", name: "SCE Bill Mismatch", utilityProvider: "Southern California Edison",
    status: "active", totalLeads: 3610, activeLeads: 1320, completedLeads: 2290,
    appointments: 318, contactRate: 31, color: "#0EA5E9", startedAt: daysAgo(21),
  },
  {
    id: "camp-3", name: "SRP Spring Audit", utilityProvider: "Salt River Project",
    status: "active", totalLeads: 2940, activeLeads: 2110, completedLeads: 830,
    appointments: 187, contactRate: 28, color: "#8B5CF6", startedAt: daysAgo(12),
  },
  {
    id: "camp-4", name: "Duke Energy Winter Review", utilityProvider: "Duke Energy",
    status: "paused", totalLeads: 2180, activeLeads: 640, completedLeads: 1540,
    appointments: 142, contactRate: 26, color: "#10B981", startedAt: daysAgo(45),
  },
  {
    id: "camp-5", name: "APS Net-Meter Outreach", utilityProvider: "Arizona Public Service",
    status: "completed", totalLeads: 1560, activeLeads: 0, completedLeads: 1560,
    appointments: 168, contactRate: 37, color: "#EC4899", startedAt: daysAgo(60),
  },
];

const leadSeeds: Array<Partial<Lead> & Pick<Lead, "firstName" | "lastName" | "city" | "state">> = [
  { firstName: "Robert", lastName: "Hayes", city: "Fresno", state: "CA", utilityBill: 248, solarPayment: 189, hasEV: true, hasPool: true, hasBattery: false, aiScore: 92 },
  { firstName: "Linda", lastName: "Powell", city: "Bakersfield", state: "CA", utilityBill: 176, solarPayment: 142, hasEV: false, hasPool: false, hasBattery: false, aiScore: 74 },
  { firstName: "Carlos", lastName: "Mendez", city: "Riverside", state: "CA", utilityBill: 312, solarPayment: 205, hasEV: true, hasPool: true, hasBattery: true, aiScore: 96 },
  { firstName: "Susan", lastName: "Bryant", city: "Sacramento", state: "CA", utilityBill: 134, solarPayment: 118, hasEV: false, hasPool: false, hasBattery: false, aiScore: 61 },
  { firstName: "Daniel", lastName: "Foster", city: "Tempe", state: "AZ", utilityBill: 289, solarPayment: 167, hasEV: true, hasPool: false, hasBattery: false, aiScore: 88 },
  { firstName: "Patricia", lastName: "Reed", city: "Mesa", state: "AZ", utilityBill: 221, solarPayment: 154, hasEV: false, hasPool: true, hasBattery: false, aiScore: 79 },
  { firstName: "Kevin", lastName: "Ward", city: "Modesto", state: "CA", utilityBill: 198, solarPayment: 161, hasEV: false, hasPool: false, hasBattery: false, aiScore: 70 },
  { firstName: "Nancy", lastName: "Cole", city: "Stockton", state: "CA", utilityBill: 264, solarPayment: 178, hasEV: true, hasPool: true, hasBattery: false, aiScore: 90 },
  { firstName: "Brian", lastName: "Gibson", city: "Chandler", state: "AZ", utilityBill: 305, solarPayment: 192, hasEV: true, hasPool: true, hasBattery: true, aiScore: 95 },
  { firstName: "Karen", lastName: "Hunter", city: "Glendale", state: "AZ", utilityBill: 158, solarPayment: 133, hasEV: false, hasPool: false, hasBattery: false, aiScore: 64 },
  { firstName: "Steven", lastName: "Diaz", city: "San Jose", state: "CA", utilityBill: 277, solarPayment: 214, hasEV: true, hasPool: false, hasBattery: false, aiScore: 86 },
  { firstName: "Donna", lastName: "Pierce", city: "Scottsdale", state: "AZ", utilityBill: 343, solarPayment: 226, hasEV: true, hasPool: true, hasBattery: true, aiScore: 98 },
  { firstName: "Edward", lastName: "Wells", city: "Visalia", state: "CA", utilityBill: 187, solarPayment: 149, hasEV: false, hasPool: false, hasBattery: false, aiScore: 68 },
  { firstName: "Michelle", lastName: "Barnes", city: "Gilbert", state: "AZ", utilityBill: 256, solarPayment: 171, hasEV: false, hasPool: true, hasBattery: false, aiScore: 83 },
  { firstName: "Gregory", lastName: "Ross", city: "Clovis", state: "CA", utilityBill: 209, solarPayment: 158, hasEV: true, hasPool: false, hasBattery: false, aiScore: 81 },
  { firstName: "Laura", lastName: "Henderson", city: "Peoria", state: "AZ", utilityBill: 231, solarPayment: 163, hasEV: false, hasPool: true, hasBattery: false, aiScore: 77 },
];

const statuses: Lead["status"][] = ["new", "contacted", "qualified", "callback", "appointment", "no_answer"];
const utilityByState: Record<string, string> = { CA: "PG&E", AZ: "Salt River Project" };

export const leads: Lead[] = leadSeeds.map((seed, i) => {
  const state = seed.state;
  return {
    id: `lead-${i + 1}`,
    firstName: seed.firstName,
    lastName: seed.lastName,
    phone: `+1${4155550100 + i * 7}`,
    email: `${seed.firstName.toLowerCase()}.${seed.lastName.toLowerCase()}@example.com`,
    address: `${1200 + i * 37} ${["Maple", "Oak", "Sunset", "Vista", "Canyon", "Desert"][i % 6]} ${["St", "Ave", "Dr", "Way"][i % 4]}`,
    city: seed.city,
    state,
    zip: state === "CA" ? `9${3000 + i}` : `8${5000 + i}`,
    utilityProvider: utilityByState[state] ?? "PG&E",
    solarProvider: ["Sunrun", "Tesla Energy", "SunPower", "Momentum Solar"][i % 4],
    status: statuses[i % statuses.length],
    campaignId: campaigns[i % 3].id,
    assignedRepId: reps[i % reps.length].id,
    solarPayment: seed.solarPayment,
    utilityBill: seed.utilityBill,
    hasEV: seed.hasEV ?? false,
    hasPool: seed.hasPool ?? false,
    hasBattery: seed.hasBattery ?? false,
    multipleSystems: i % 5 === 0,
    notes: i % 3 === 0 ? "Mentioned bill spiked after adding EV charger." : undefined,
    lastContactedAt: i % 2 === 0 ? minsAgo(30 + i * 12) : undefined,
    createdAt: daysAgo(3 + (i % 14)),
    aiScore: seed.aiScore,
    timezone: state === "CA" ? "PT" : "MT",
  };
});

export const activeCalls: ActiveCall[] = [
  {
    id: "ac-1", repId: "rep-1", repName: "Maya Rodriguez", repInitials: "MR", repColor: "#3B82F6",
    leadName: "Robert Hayes", leadCity: "Fresno, CA", phone: "+14155550100",
    startedAt: minsAgo(3), state: "connected", campaign: "PG&E True-Up Recovery", sentiment: "positive",
  },
  {
    id: "ac-2", repId: "rep-2", repName: "James Carter", repInitials: "JC", repColor: "#0EA5E9",
    leadName: "Linda Powell", leadCity: "Bakersfield, CA", phone: "+14155550107",
    startedAt: minsAgo(1), state: "connected", campaign: "SCE Bill Mismatch", sentiment: "neutral",
  },
  {
    id: "ac-3", repId: "rep-5", repName: "Aisha Khan", repInitials: "AK", repColor: "#EC4899",
    leadName: "Carlos Mendez", leadCity: "Riverside, CA", phone: "+14155550114",
    startedAt: minsAgo(6), state: "connected", campaign: "PG&E True-Up Recovery", sentiment: "positive",
  },
  {
    id: "ac-4", repId: "rep-3", repName: "Priya Nair", repInitials: "PN", repColor: "#8B5CF6",
    leadName: "Daniel Foster", leadCity: "Tempe, AZ", phone: "+14155550128",
    startedAt: minsAgo(0.3), state: "ringing", campaign: "SRP Spring Audit", sentiment: "neutral",
  },
  {
    id: "ac-5", repId: "rep-4", repName: "Devon Brooks", repInitials: "DB", repColor: "#10B981",
    leadName: "Susan Bryant", leadCity: "Sacramento, CA", phone: "+14155550121",
    startedAt: minsAgo(8), state: "wrap_up", campaign: "PG&E True-Up Recovery", sentiment: "positive",
  },
];

export const appointments: Appointment[] = [
  { id: "apt-1", leadId: "lead-3", leadName: "Carlos Mendez", repId: "rep-5", repName: "Aisha Khan", scheduledAt: hoursFromNow(2), durationMin: 30, status: "scheduled", address: "1274 Sunset Dr, Riverside, CA", utilityBill: 312, solarPayment: 205, source: "rep", notes: "High EV + pool usage. Strong fit." },
  { id: "apt-2", leadId: "lead-9", leadName: "Brian Gibson", repId: "rep-1", repName: "Maya Rodriguez", scheduledAt: hoursFromNow(4), durationMin: 30, status: "scheduled", address: "1496 Desert Way, Chandler, AZ", utilityBill: 305, solarPayment: 192, source: "ai" },
  { id: "apt-3", leadId: "lead-12", leadName: "Donna Pierce", repId: "rep-1", repName: "Maya Rodriguez", scheduledAt: hoursFromNow(6), durationMin: 45, status: "scheduled", address: "1644 Vista Ave, Scottsdale, AZ", utilityBill: 343, solarPayment: 226, source: "rep" },
  { id: "apt-4", leadId: "lead-1", leadName: "Robert Hayes", repId: "rep-2", repName: "James Carter", scheduledAt: hoursFromNow(26), durationMin: 30, status: "scheduled", address: "1200 Maple St, Fresno, CA", utilityBill: 248, solarPayment: 189, source: "ai" },
  { id: "apt-5", leadId: "lead-8", leadName: "Nancy Cole", repId: "rep-3", repName: "Priya Nair", scheduledAt: daysAgo(1), durationMin: 30, status: "completed", address: "1459 Oak St, Stockton, CA", utilityBill: 264, solarPayment: 178, source: "rep" },
  { id: "apt-6", leadId: "lead-5", leadName: "Daniel Foster", repId: "rep-4", repName: "Devon Brooks", scheduledAt: daysAgo(1), durationMin: 30, status: "no_show", address: "1385 Canyon Dr, Tempe, AZ", utilityBill: 289, solarPayment: 167, source: "ai" },
  { id: "apt-7", leadId: "lead-11", leadName: "Steven Diaz", repId: "rep-5", repName: "Aisha Khan", scheduledAt: daysAgo(2), durationMin: 45, status: "completed", address: "1607 Vista Way, San Jose, CA", utilityBill: 277, solarPayment: 214, source: "rep" },
];

export const callbacks: Callback[] = [
  { id: "cb-1", leadId: "lead-2", leadName: "Linda Powell", phone: "+14155550107", repId: "rep-1", repName: "Maya Rodriguez", dueAt: minsAgo(35), reason: "Asked to call after 3pm", status: "overdue" },
  { id: "cb-2", leadId: "lead-7", leadName: "Kevin Ward", phone: "+14155550142", repId: "rep-1", repName: "Maya Rodriguez", dueAt: hoursFromNow(0.5), reason: "Wants to review bill with spouse", status: "due" },
  { id: "cb-3", leadId: "lead-13", leadName: "Edward Wells", phone: "+14155550184", repId: "rep-1", repName: "Maya Rodriguez", dueAt: hoursFromNow(3), reason: "Requested afternoon callback", status: "upcoming" },
  { id: "cb-4", leadId: "lead-6", leadName: "Patricia Reed", phone: "+14155550135", repId: "rep-3", repName: "Priya Nair", dueAt: hoursFromNow(5), reason: "Checking last 3 utility statements", status: "upcoming" },
  { id: "cb-5", leadId: "lead-10", leadName: "Karen Hunter", phone: "+14155550163", repId: "rep-2", repName: "James Carter", dueAt: minsAgo(90), reason: "No answer — retry", status: "overdue" },
  { id: "cb-6", leadId: "lead-14", leadName: "Michelle Barnes", phone: "+14155550191", repId: "rep-1", repName: "Maya Rodriguez", dueAt: hoursFromNow(1.5), reason: "Gathering pool pump details", status: "upcoming" },
];

const outcomes: CallRecord["outcome"][] = [
  "appointment_booked", "callback_scheduled", "qualified", "not_interested", "no_answer", "voicemail",
];
const dispositions: CallRecord["disposition"][] = ["answered", "answered", "voicemail", "answered", "no_answer", "voicemail"];

export const callRecords: CallRecord[] = Array.from({ length: 14 }).map((_, i) => ({
  id: `call-${i + 1}`,
  leadId: `lead-${(i % leads.length) + 1}`,
  leadName: `${leads[i % leads.length].firstName} ${leads[i % leads.length].lastName}`,
  repId: reps[i % reps.length].id,
  repName: reps[i % reps.length].name,
  phone: leads[i % leads.length].phone,
  startedAt: minsAgo(8 + i * 17),
  durationSec: [212, 47, 318, 95, 0, 36, 274, 188, 12, 421, 156, 0, 203, 88][i],
  outcome: outcomes[i % outcomes.length],
  disposition: dispositions[i % dispositions.length],
  recordingUrl: dispositions[i % dispositions.length] === "answered" ? "#" : undefined,
  campaignId: campaigns[i % 3].id,
  hasSummary: i % 2 === 0,
}));

export const kpiSeries: KpiPoint[] = [
  { label: "Mon", calls: 1840, conversations: 486, appointments: 64, connectRate: 26 },
  { label: "Tue", calls: 2120, conversations: 571, appointments: 78, connectRate: 27 },
  { label: "Wed", calls: 1980, conversations: 524, appointments: 71, connectRate: 26 },
  { label: "Thu", calls: 2340, conversations: 648, appointments: 92, connectRate: 28 },
  { label: "Fri", calls: 2580, conversations: 731, appointments: 104, connectRate: 28 },
  { label: "Sat", calls: 1460, conversations: 392, appointments: 51, connectRate: 27 },
  { label: "Sun", calls: 980, conversations: 248, appointments: 33, connectRate: 25 },
];

export const hourlyCalls = [
  { hour: "8a", calls: 142, connects: 38 },
  { hour: "9a", calls: 318, connects: 92 },
  { hour: "10a", calls: 386, connects: 118 },
  { hour: "11a", calls: 412, connects: 131 },
  { hour: "12p", calls: 298, connects: 79 },
  { hour: "1p", calls: 356, connects: 104 },
  { hour: "2p", calls: 421, connects: 138 },
  { hour: "3p", calls: 448, connects: 149 },
  { hour: "4p", calls: 392, connects: 122 },
  { hour: "5p", calls: 287, connects: 81 },
];

export const outcomeBreakdown = [
  { name: "Appointment", value: 18, color: "var(--color-chart-3)" },
  { name: "Callback", value: 23, color: "var(--color-chart-1)" },
  { name: "Qualified", value: 14, color: "var(--color-chart-2)" },
  { name: "Not interested", value: 21, color: "var(--color-chart-5)" },
  { name: "No answer", value: 24, color: "var(--color-chart-4)" },
];

export const metrics: MetricSummary = {
  totalCalls: 48720,
  callsToday: 2580,
  connections: 731,
  conversations: 731,
  avgCallLenSec: 196,
  connectRate: 28.3,
  appointmentRate: 14.2,
  callbackRate: 19.7,
  noAnswerRate: 41.5,
  appointmentsBooked: 104,
  appointmentsCompleted: 71,
  noShows: 12,
  reschedules: 9,
  avgUtilityBill: 241,
  avgSolarPayment: 174,
  avgTotalEnergyCost: 415,
  evOwnership: 43,
  poolOwnership: 38,
  batteryOwnership: 21,
};

export const outcomeOptions: OutcomeOption[] = [
  { value: "appointment_booked", label: "Appointment booked", description: "Account review scheduled", tone: "success" },
  { value: "callback_scheduled", label: "Callback", description: "Homeowner asked to be called back", tone: "warning" },
  { value: "qualified", label: "Qualified", description: "Good fit, continue nurturing", tone: "success" },
  { value: "not_interested", label: "Not interested", description: "Declined further contact", tone: "neutral" },
  { value: "bills_fine", label: "Bills are fine", description: "Happy with current bills — revisit later", tone: "warning" },
  { value: "no_answer", label: "No answer", description: "Rang out, no pickup", tone: "neutral" },
  { value: "voicemail", label: "Voicemail", description: "Left a voicemail", tone: "neutral" },
  { value: "wrong_number", label: "Wrong number", description: "Number does not reach lead", tone: "danger" },
  { value: "do_not_call", label: "Do not call", description: "Add to DNC list", tone: "danger" },
];

// Leaderboard derived from reps, sorted by score.
export const leaderboard = [...reps]
  .filter((r) => r.role === "rep")
  .sort((a, b) => b.score - a.score);

export function getLeadById(id: string) {
  return leads.find((l) => l.id === id);
}

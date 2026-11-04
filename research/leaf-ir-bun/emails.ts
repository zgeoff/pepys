import { longEmails } from './long-emails.ts';

// Every email here is invented for the spike. No name, address or order belongs to a real person.

export interface Email {
  id: string;
  subject: string;
  body: string;
}

export const emails: Email[] = [
  {
    id: 'e001',
    subject: 'Your flight to Lisbon is confirmed',
    body: 'Booking reference QX7PLM. Departs Thursday 14 May at 07:35 from gate area B, arriving 10:20 local time. One cabin bag of up to 10 kg is included. Online check-in opens 30 hours before departure.',
  },
  {
    id: 'e002',
    subject: 'Change to your rail journey on Saturday',
    body: 'Engineering works mean the 09:12 service to Harrowgate now leaves at 09:40 and calls at every station. Your seat reservation in coach C still stands. No action is needed unless you want a refund.',
  },
  {
    id: 'e003',
    subject: 'Receipt for your order #44120',
    body: 'Thanks for shopping with Fernhill Outdoors. Items: one waterproof hiking jacket, size M, and two pairs of merino socks. Total charged to the card ending 0042: 189.50. Delivery expected within 3 working days.',
  },
  {
    id: 'e004',
    subject: 'Dentist appointment reminder',
    body: 'This is a reminder of your check-up with Dr Okafor at Bramble Lane Dental on Tuesday at 15:30. Please arrive ten minutes early. Reply C to confirm or R to rearrange.',
  },
  {
    id: 'e005',
    subject: '[ledgerline] CI failed on main: integration tests timed out',
    body: 'The workflow "test" failed on commit 3f9a2c1. Job integration-postgres exceeded the 15 minute limit while waiting for the database container to report healthy. The previous run on the same commit passed.',
  },
  {
    id: 'e006',
    subject: 'Re: Saturday barbecue',
    body: 'Count us in! We will bring a salad and some lemonade for the kids. Is it still at the park by the river, or did you move it to your garden because of the forecast? Let me know what time works.',
  },
  {
    id: 'e007',
    subject: 'Your electricity bill for October',
    body: 'Your bill from Northgrid Energy is ready. Amount due: 84.17, to be collected by direct debit on the 21st. Your usage was 12% lower than the same month last year. Log in to see a breakdown by day.',
  },
  {
    id: 'e008',
    subject: 'Password reset requested',
    body: 'Someone asked to reset the password for your Quillbox account. If this was you, use the link below within 30 minutes. If it was not you, you can ignore this email and your password will stay the same.',
  },
  {
    id: 'e009',
    subject: 'Invitation: quarterly planning review',
    body: 'Priya Ramaswell has invited you to "Q3 planning review" on Wednesday from 14:00 to 15:30 in the Larch meeting room and on video. Agenda: roadmap priorities, hiring plan, and the budget for the data platform.',
  },
  {
    id: 'e010',
    subject: 'Library books due back soon',
    body: 'Two items on your Westbury Libraries card are due on Friday: "The Salt Roads of Europe" and "Practical Sourdough". You can renew each item online up to three times if nobody else has reserved it.',
  },
  {
    id: 'e011',
    subject: 'Your parcel has been delivered',
    body: 'Your parcel from Pixelcraft Supplies was delivered at 11:42 and left in your safe place: the porch behind the blue bin. A photo of the delivery is available in the tracking page.',
  },
  {
    id: 'e012',
    subject: 'Pull request #212 review requested: add retry to webhook sender',
    body: 'Tomas Velde requested your review on ledgerline#212. The change wraps outgoing webhook calls in an exponential backoff with jitter, capped at five attempts, and adds a dead-letter table for calls that still fail.',
  },
  {
    id: 'e013',
    subject: 'Home insurance renewal',
    body: 'Your home contents policy with Harbour Mutual renews on 1 December. The new annual premium is 212.40, up from 198.00 last year, mainly because of higher claims costs in your area. You can switch to monthly payments at no cost.',
  },
  {
    id: 'e014',
    subject: 'Running club: new route this week',
    body: 'Hi all, Thursday night we are trying the canal loop instead of the hill route. It is about 7 km and mostly flat, so a good one for anyone coming back from injury. Meet at the boathouse at 18:45 as usual.',
  },
  {
    id: 'e015',
    subject: 'Security alert: new sign-in from Firefox on Linux',
    body: 'We noticed a new sign-in to your Quillbox account from Firefox on Linux near Rotterdam. If this was you, there is nothing to do. If not, change your password now and review the devices signed in to your account.',
  },
  {
    id: 'e016',
    subject: "Mum's birthday plans",
    body: 'I have booked a table at the Italian place on Elm Street for Sunday at 1pm, for eight people. Can you pick up the cake from the bakery on the way? I paid for it already, it is under my name. She still has no idea.',
  },
  {
    id: 'e017',
    subject: 'Hotel reservation confirmation: Porto, 3 nights',
    body: 'Casa do Rio Guesthouse confirms your double room from 17 to 20 May. Breakfast is included. Check-in from 15:00, check-out by 11:00. Free cancellation until 48 hours before arrival.',
  },
  {
    id: 'e018',
    subject: 'Weekly digest: Systems Notes #187',
    body: 'This week: how a team cut their Postgres vacuum times in half by partitioning a hot table, a short history of consistent hashing, and why your retry loop needs jitter. Plus three job listings.',
  },
  {
    id: 'e019',
    subject: 'Your gym membership will be frozen',
    body: 'As requested, your Corefit membership will be frozen from 1 to 31 December. You will not be charged during this period. Your access card will stop working on the 1st and start again automatically in January.',
  },
  {
    id: 'e020',
    subject: '[ledgerline] Issue #198: export to CSV drops rows with commas in the memo',
    body: 'Reported by a user: when a transaction memo contains a comma, the CSV export splits it into two columns and the import on the other side rejects the file. We need to quote fields properly rather than replace commas.',
  },
  {
    id: 'e021',
    subject: 'Car service booked',
    body: 'Your car is booked in at Millbrook Motors for its annual service and MOT on Monday 9 November at 08:30. Please leave the keys at reception. We will call you if we find anything that needs work beyond the quote.',
  },
  {
    id: 'e022',
    subject: 'School trip consent form',
    body: 'Year 5 are visiting the science museum on 20 November. Please sign and return the consent form by Friday, along with 12.00 for the coach. Children need a packed lunch and a waterproof coat.',
  },
  {
    id: 'e023',
    subject: 'Refund processed for order #43871',
    body: 'We have refunded 45.99 to your original payment method for the returned headphones. It can take up to five working days to appear on your statement. Thanks for your patience.',
  },
  {
    id: 'e024',
    subject: 'Offer letter: Senior Platform Engineer',
    body: 'Following your interviews, Brightwater Analytics is pleased to offer you the role of Senior Platform Engineer. The attached letter sets out salary, start date and benefits. Please let us know your decision by the end of next week.',
  },
  {
    id: 'e025',
    subject: 'Allotment committee minutes',
    body: 'Minutes from Sunday: the water troughs will be switched off from 1 November. Plot 14 is available to the next person on the waiting list. The shed roof repair was approved, up to 300 from the maintenance fund.',
  },
  {
    id: 'e026',
    subject: 'Re: rental deposit',
    body: 'Thanks for sending the photos from the move-out inspection. The landlord has agreed to return the full deposit of 1,450 minus 60 for the oven cleaning. The money should reach your account within ten days.',
  },
  {
    id: 'e027',
    subject: 'Your subscription to Streamly will renew',
    body: 'Your annual Streamly Premium plan renews on 12 November for 119.99. If you do not want to renew, cancel at least 24 hours before that date from your account settings.',
  },
  {
    id: 'e028',
    subject: 'Deployment succeeded: ledgerline-api v2.14.0 to production',
    body: 'The release ledgerline-api v2.14.0 rolled out to all 6 production pods. Error rate stayed below 0.1% during the rollout. Changes include the new invoice numbering and a fix for duplicate webhook deliveries.',
  },
  {
    id: 'e029',
    subject: 'Vet appointment for Biscuit',
    body: 'Biscuit is due her annual booster vaccination. We have reserved Wednesday at 10:15 with Ms Harlow. Please bring her vaccination card. If she has been off her food, mention it at the appointment.',
  },
  {
    id: 'e030',
    subject: "Book club: next month's pick",
    body: 'We voted and the winner is "The Glass Orchard". We will meet at Hana\'s flat on the last Thursday of the month. Bring snacks, and please finish the book this time.',
  },
  {
    id: 'e031',
    subject: 'Tax return reminder',
    body: 'Your self assessment tax return for the last tax year must be filed online by 31 January. You can save a draft and come back to it. Late returns get a penalty of 100, even if no tax is owed.',
  },
  {
    id: 'e032',
    subject: 'Flight delay: your evening departure',
    body: 'We are sorry, your flight FX 2281 to Edinburgh is delayed by about 2 hours because of a late inbound aircraft. The new departure time is 21:05. Meal vouchers are available at the service desk.',
  },
  {
    id: 'e033',
    subject: 'Thanks for your donation',
    body: 'Thank you for your gift of 25 to the Riverside Food Bank. Your donation will provide around 30 meals for families in our area this winter. With Gift Aid, it is worth 31.25 to us.',
  },
  {
    id: 'e034',
    subject: 'Re: kitchen tap leaking',
    body: 'I can come round on Thursday morning between 8 and 10 to look at the tap. From your photo it sounds like the cartridge is worn rather than the whole unit, which is a cheaper fix. I will bring a replacement just in case.',
  },
  {
    id: 'e035',
    subject: 'Your bank statement is ready',
    body: 'Your October statement for the current account ending 7731 is ready to view in online banking. For security, we never include account details in emails.',
  },
  {
    id: 'e036',
    subject: '[ledgerline] Dependabot: bump express from 4.21.0 to 4.21.2',
    body: 'Bumps express from 4.21.0 to 4.21.2. Release notes: fixes an open redirect in res.location, and a path matching regression. Compatibility score: 98%.',
  },
  {
    id: 'e037',
    subject: 'Neighbourhood watch: bikes stolen from sheds',
    body: 'Two bikes were taken from garden sheds on Orchard Close over the weekend. Police advise using a ground anchor and marking frames. If you have a doorbell camera, please check footage from Saturday night.',
  },
  {
    id: 'e038',
    subject: 'Order shipped: 3 items on the way',
    body: 'Good news: your order from Pagebound Books has shipped. Items: a hardback atlas, a notebook, and a set of fountain pen cartridges. Tracking number LN448210933. Estimated delivery Wednesday.',
  },
  {
    id: 'e039',
    subject: 'Interview feedback',
    body: 'Thanks for taking the time to interview with Coastline Labs. The panel enjoyed the system design discussion, but we have decided to move forward with a candidate whose experience matches the mobile focus of the role more closely.',
  },
  {
    id: 'e040',
    subject: 'Water outage on your street',
    body: 'Riverbend Water will be replacing a main on Linden Road on Tuesday. Your supply may be off from 09:00 to 15:00. Please store some drinking water the night before. We apologise for the disruption.',
  },
  {
    id: 'e041',
    subject: 'Re: lift to the airport',
    body: 'Happy to drive you to the airport on the 14th. If your flight is at 07:35 we should leave by 5 to be safe. I will need to be back for work by 9, so no hanging around at the drop-off point!',
  },
  {
    id: 'e042',
    subject: 'Your ride receipt',
    body: 'Thanks for riding with Zipcab. Trip from Central Station to Ashdown Road, 6.2 km, 18 minutes. Fare 14.60, tip 2.00. Rate your driver to help us keep rides safe.',
  },
  {
    id: 'e043',
    subject: 'Course enrolment confirmed: Introduction to Pottery',
    body: 'You are enrolled on Introduction to Pottery, Monday evenings from 19:00 to 21:00 for eight weeks, starting next Monday. All clay and glazes are included. Wear clothes you do not mind getting dirty.',
  },
  {
    id: 'e044',
    subject: 'Incident report: elevated latency on payments API',
    body: 'Between 13:02 and 13:41 UTC, p99 latency on the payments API rose to 4.2 s. The cause was a missing index after the migration that added the settlement_batch column. The index was added and latency returned to normal.',
  },
  {
    id: 'e045',
    subject: 'Plant swap this Saturday',
    body: 'The community garden is holding a plant swap on Saturday from 10 until noon. Bring cuttings, seedlings or seeds in labelled pots and take home something new. Tea and cake by donation.',
  },
  {
    id: 'e046',
    subject: 'Your mobile bill',
    body: 'Your Tidewave Mobile bill is 18.00 this month. You used 6.1 GB of your 20 GB allowance. Roaming in the EU is included in your plan.',
  },
  {
    id: 'e047',
    subject: 'Re: borrowing the ladder',
    body: 'Of course you can borrow it. It is the tall one hanging in the garage, and the garage code is the same as before. Just bring it back by the weekend because I need it to clear the gutters.',
  },
  {
    id: 'e048',
    subject: 'Conference talk accepted',
    body: 'Congratulations! Your talk "Event sourcing for one: a personal data log" has been accepted for Northern Dev Days. You have a 30 minute slot on the second day. Please confirm your travel needs by the end of the month.',
  },
  {
    id: 'e049',
    subject: 'Your prescription is ready',
    body: 'Your repeat prescription is ready to collect from Greenway Pharmacy on the high street. Bring photo ID if someone else is collecting it for you. We are open until 18:00 on weekdays.',
  },
  {
    id: 'e050',
    subject: 'Holiday cottage: arrival details',
    body: 'We look forward to welcoming you to Heron Cottage. The key safe is to the left of the front door and the code is in your booking. The wood burner has logs in the store. Please keep dogs off the sofas.',
  },
  {
    id: 'e051',
    subject: '[ledgerline] Issue #201: rate limiter blocks health checks',
    body: 'The load balancer health checks hit the API every 2 seconds from three addresses, and since the new rate limiter shipped they get 429 responses, which marks pods unhealthy. We should exempt the /healthz route.',
  },
  {
    id: 'e052',
    subject: 'Council tax: new annual bill',
    body: 'Your council tax bill for the coming year is 1,876.32, payable in ten monthly instalments from April. You may be entitled to a single person discount if you live alone.',
  },
  {
    id: 'e053',
    subject: 'Re: football training cancelled',
    body: 'Sorry for the short notice, training tonight is off because the pitch is waterlogged. We will do a double session next week instead. Match on Saturday is still on, kick-off 10am.',
  },
  {
    id: 'e054',
    subject: 'Your table is booked',
    body: 'Thank you for booking with Olive & Ember. Your table for 2 is reserved for Friday at 19:30. We hold tables for 15 minutes. Let us know about any allergies before you arrive.',
  },
  {
    id: 'e055',
    subject: 'Broadband upgrade available',
    body: 'Full fibre is now available at your address. You can upgrade to 500 Mbps for 4 more per month than you pay today, with no new contract term. An engineer visit takes about two hours.',
  },
  {
    id: 'e056',
    subject: 'Recipe you saved: slow-cooked lamb shoulder',
    body: 'You saved this recipe last week. Rub the lamb with garlic, rosemary and salt, then roast at 150C for four hours, covered, until the meat pulls apart. Rest for 20 minutes before serving with the pan juices.',
  },
  {
    id: 'e057',
    subject: 'Contract renewal for the office cleaning',
    body: 'Our cleaning contract with your office ends on 30 November. We propose to renew for another 12 months at the same rate, with an extra deep clean of the kitchen each quarter. Let me know if you would like to discuss.',
  },
  {
    id: 'e058',
    subject: 'Pull request #219 merged: paginate the transactions endpoint',
    body: 'Nadia Krol merged ledgerline#219 into main. The /transactions endpoint now returns at most 200 rows per page with a cursor, so the mobile app no longer times out on accounts with years of history.',
  },
  {
    id: 'e059',
    subject: 'Eye test due',
    body: 'It has been two years since your last eye test at Clearview Opticians. Regular eye tests can spot health problems early. Book online or call the practice to choose a time.',
  },
  {
    id: 'e060',
    subject: 'Re: wedding RSVP',
    body: 'We would love to come to the wedding! Two adults, no children. One of us is vegetarian. Do you know yet whether there is a shuttle from the hotel to the venue, or should we plan to drive?',
  },
  {
    id: 'e061',
    subject: 'Your pension annual statement',
    body: 'Your annual pension statement from Evergreen Pensions is available. Your pot is projected to provide an income of 14,200 a year from age 67, based on current contributions and an assumed growth rate.',
  },
  {
    id: 'e062',
    subject: 'Ferry booking: Portsmouth to Bilbao',
    body: 'Your crossing on the Galicia Star departs Portsmouth on 2 July at 21:15 and arrives Bilbao 4 July at 08:00. Booking includes one car under 1.85 m and a two-berth inside cabin.',
  },
  {
    id: 'e063',
    subject: 'Your review is live',
    body: 'Thanks for reviewing the cordless drill you bought from Toolhaus. Your review is now visible on the product page and 4 people found it helpful.',
  },
  {
    id: 'e064',
    subject: 'Nursery fees for November',
    body: 'Fees for November are 640.00 for three days a week. Please pay by bank transfer by the 5th. The nursery will be closed on the 24th for staff training.',
  },
  {
    id: 'e065',
    subject: 'Re: architecture question about the event log',
    body: 'I think you are right that the log should be the only source of truth. If every projection can be rebuilt from it, schema changes stop being scary. The cost is replay time, so we need snapshots once the log gets large.',
  },
  {
    id: 'e066',
    subject: 'Windows cleaning next week',
    body: 'Hi, just letting you know I will be round on Tuesday to do the windows, front and back. If the side gate is locked I will do the front only. Payment by the usual link.',
  },
  {
    id: 'e067',
    subject: 'Parking fine notice',
    body: 'A penalty charge of 70 was issued to vehicle AB12 CDE on Market Street for parking in a loading bay. Pay within 14 days to reduce it to 35, or appeal online with photos.',
  },
  {
    id: 'e068',
    subject: '[ledgerline] Security advisory: token leaked in build logs',
    body: 'A deploy token was printed in the build logs of a failed release job last Tuesday. The token has been revoked and replaced. We have added log masking for every secret and audited access, and found no use of the token.',
  },
  {
    id: 'e069',
    subject: 'Museum membership renewed',
    body: 'Thank you for renewing your membership of the City Museum of Science. Your card gives you free entry to every exhibition and 10% off in the café for the next 12 months.',
  },
  {
    id: 'e070',
    subject: 'Re: borrowing your tent',
    body: 'Thanks so much for the tent! We had a brilliant weekend in the hills, and only one night of rain. I have dried it out properly and will drop it back round on Wednesday evening.',
  },
  {
    id: 'e071',
    subject: 'Your boiler service is due',
    body: 'Your annual gas boiler service is due this month. Keeping it serviced keeps your warranty valid. Our engineers have slots on weekday mornings next week. Reply to choose a day.',
  },
  {
    id: 'e072',
    subject: 'Volunteer rota for December',
    body: 'Here is the December rota for the food bank. You are down for the first and third Saturday mornings. If you cannot make a shift, please swap with someone and let me know.',
  },
  {
    id: 'e073',
    subject: 'Credit card payment due',
    body: 'Your minimum payment of 25.00 on the card ending 0042 is due on the 18th. Your full balance is 612.34. Paying in full avoids interest charges.',
  },
  {
    id: 'e074',
    subject: 'Re: pairing on the migration tool',
    body: 'Friday afternoon works for me. Let us start with the part that copies the old ledger tables into the new event format, since that is where the bugs were last time. I will set up a branch beforehand.',
  },
  {
    id: 'e075',
    subject: 'Concert tickets: The Hollow Pines',
    body: 'Your 2 tickets for The Hollow Pines at the Corn Exchange on 6 December are attached. Doors open at 19:00. Bags larger than A4 are not allowed in the venue.',
  },
  {
    id: 'e076',
    subject: 'Account statement from Ashby Savings',
    body: 'Interest of 31.80 was paid into your easy access savings account this month. Your new balance is 4,212.07. The interest rate is variable and is now 4.1% gross.',
  },
  {
    id: 'e077',
    subject: 'Bin collection changes over the holidays',
    body: 'Over the holidays, bins will be collected two days later than normal. Real Christmas trees can be left next to your garden waste bin in the first two weeks of January, cut into pieces.',
  },
  {
    id: 'e078',
    subject: 'Re: climbing on Thursday?',
    body: 'Thursday is good, the wall is quieter after 8. I will bring the rope if you bring the quickdraws. My shoulder is better but I will stick to the easier routes for a couple of weeks.',
  },
  {
    id: 'e079',
    subject: 'Welcome to Fernhill Outdoors rewards',
    body: 'You have joined our rewards programme. You earn one point per pound spent, and every 200 points gives you 10 off your next order. Points expire after 24 months without a purchase.',
  },
  {
    id: 'e080',
    subject: "Doctor's surgery: flu vaccine clinic",
    body: 'Our flu vaccine clinics run on Saturday mornings in October and November. You are eligible for a free vaccine. Book a slot online or by phone. Please wear a short-sleeved top.',
  },
  {
    id: 'e081',
    subject: 'Weekly digest: Personal Finance Brief',
    body: 'This week: how to read a pension statement, why your savings rate matters more than your returns, and a checklist for switching energy suppliers before winter.',
  },
  {
    id: 'e082',
    subject: '[ledgerline] Issue #205: dark mode makes chart labels unreadable',
    body: 'With the dark theme enabled, the axis labels on the spending chart are dark grey on a black background. The chart component ignores the theme tokens and hard-codes the colours.',
  },
  {
    id: 'e083',
    subject: 'Re: moving the standup',
    body: 'Since half the team now starts at 10, can we move the daily standup from 09:30 to 10:15? It would also stop clashing with the school run for a few of us. Objections by Friday please.',
  },
  {
    id: 'e084',
    subject: 'Your passport application',
    body: 'We have received your passport renewal application and supporting documents. Applications are currently taking up to three weeks to process. We will send your old passport back separately.',
  },
  {
    id: 'e085',
    subject: 'Furniture delivery slot',
    body: 'Your new sofa from Oakwell Home will be delivered on Saturday between 07:00 and 11:00. Our two-person team will carry it to the room of your choice and take away the packaging.',
  },
  {
    id: 'e086',
    subject: 'Re: cat sitting while we are away',
    body: 'Of course I can feed Pepper while you are in Portugal. Leave the spare key under the plant pot and a note about how much food she gets. I will text you a photo every day so you do not worry.',
  },
  {
    id: 'e087',
    subject: 'Quarterly report from your investment platform',
    body: 'Your stocks and shares ISA grew by 3.2% over the quarter. Fees of 11.40 were taken in total. You have 2,000 of your annual allowance left to use before April.',
  },
  {
    id: 'e088',
    subject: 'Scheduled maintenance: Quillbox will be unavailable',
    body: 'Quillbox will be unavailable on Sunday from 02:00 to 04:00 UTC while we upgrade our database servers. Your files are safe and sync will resume automatically when the work is done.',
  },
  {
    id: 'e089',
    subject: 'Re: offsite planning',
    body: 'For the team offsite I found a barn conversion about an hour from the office with a big meeting room and space for twenty. It is available in the second week of March. Shall I hold it?',
  },
  {
    id: 'e090',
    subject: 'Swimming lessons: term ends',
    body: 'This term of swimming lessons ends next Friday. Jamie has passed stage 4 and can move up to stage 5. Re-enrolment for next term opens on Monday and places go quickly.',
  },
  {
    id: 'e091',
    subject: 'Welcome to Brightwater Analytics',
    body: 'We are delighted you are joining us as Senior Platform Engineer. Your first day is Monday 4 January. Please bring proof of your right to work. Your laptop will be ready at the front desk at 09:00, and your manager will meet you there.',
  },
  {
    id: 'e092',
    subject: 'Your car insurance quote',
    body: 'Here is your renewal quote for your car insurance: 412.00 a year, including breakdown cover. Your no claims bonus is now 6 years. Accept the quote online before the 30th to keep your cover running.',
  },
  {
    id: 'e093',
    subject: 'Re: printer on the second floor',
    body: 'The second floor printer is jammed again. I opened the back panel and found a torn sheet stuck in the rollers, but it keeps showing the error. Could facilities call the engineer?',
  },
  {
    id: 'e094',
    subject: 'Weekly digest: Systems Notes #188',
    body: 'This week: running SQLite in production for a year, the trade-offs of event sourcing for small teams, how to test a migration against a copy of production data, and a review of three log shipping tools.',
  },
  {
    id: 'e095',
    subject: 'Re: lost glove',
    body: 'Was that your grey glove left on the bench after the match? I picked it up and have it in my car. I can drop it off at the school gate on Monday morning.',
  },
  {
    id: 'e096',
    subject: 'The garden centre: winter opening hours',
    body: 'From 1 November we open from 09:00 to 16:30 every day. Our café will close at 16:00. Christmas trees arrive in the last week of November.',
  },
  {
    id: 'e097',
    subject: 'Your annual energy review',
    body: 'Over the last year you used 2,840 kWh of electricity and 9,120 kWh of gas. Your direct debit of 140 a month is about right for your usage, so we will keep it the same.',
  },
  {
    id: 'e098',
    subject: 'Re: old photos',
    body: 'I found a box of old photos in the loft from when we lived on Mill Lane, including the camping trip to the lakes with the orange tent. I will scan them this weekend and share a folder with everyone.',
  },
  ...longEmails,
];

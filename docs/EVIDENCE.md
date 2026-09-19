# CareCompanion: Why This Matters

Evidence for the "Potential Impact" criterion; every figure was read from its cited source on 2026-09-19.

**Summary.** A third of Americans aged 60 to 79 take five or more prescription drugs; ordinary ones, mostly through unintentional overdose, put roughly 100,000 older adults in hospital each year. Over-the-counter painkillers raise bleeding and kidney risk; blood-pressure medicines are tied to dizziness and falls. Sixty-three million family caregivers watch over these adults, many remotely, and Amazon has retired its remote-caregiving subscription. CareCompanion's dose guard, interaction warnings, graded escalation and family dashboard fill that gap.

## 1. Multiple medications are the norm

- CDC/NCHS: "Use of five or more prescription drugs was also more common among adults aged 60–79 compared with those aged 40–59 in both the United States (34.5% versus 14.5%)." [1] More drugs, more to catch.
- AHRQ calls polypharmacy "likely the strongest risk factor for ADEs." [2]

## 2. Medication harm ends in the ED

- JAMA 2021: ED visits for medication harms ran "12.1 vs 5.0 ... per 1000 population" for ages 65+ versus younger; "38.6% ... resulted in hospitalization." Top drugs for 65+: warfarin (20.7%), insulin (11.1%), clopidogrel (10.9%), apixaban (8%), rivaroxaban (6.3%). [3] These head the curated table.
- NEJM 2011: "an estimated 99,628 emergency hospitalizations" a year for adverse drug events in adults 65+; "Nearly two thirds of hospitalizations were due to unintentional overdoses (65.7% ...)". [4] The duplicate/too-soon guard targets exactly this.

## 3. Non-adherence

- CDC MMWR: "Approximately one in five new prescriptions are never filled, and among those filled, approximately 50% are taken incorrectly". [5]
- Same source: nonadherence costs "approximately $100–$300 billion of U.S. health care dollars spent annually". [5] A confirmed-dose log gives caregivers adherence visibility.

## 4. Two everyday interactions

- Warfarin plus NSAID (meta-analysis): "The odds ratio (OR) for gastrointestinal bleeding when exposed to warfarin and an NSAID was 1.98 (95% confidence interval [CI]: 1.55-2.53)". [6]
- ACE inhibitor/ARB plus diuretic plus NSAID (BMJ, 487,372 users): "increased rate of acute kidney injury (rate ratio 1.31, 95% confidence interval 1.12 to 1.53)", highest "in the first 30 days of use (rate ratio 1.82, 1.35 to 2.46)." [7] Both start with over-the-counter ibuprofen; the warning fires at "I'm taking ibuprofen".

## 5. Dizziness, blood-pressure medicines and falls

- CDC: "Over 14 million, or 1 in 4 older adults report falling every year." [8] Medical costs are "approximately $50 billion every year". [9]
- CDC STEADI lists "Medications affecting blood pressure" among drugs that "can cause dizziness, sedation, confusion, blurred vision, or orthostatic hypotension." [10]
- JAMA Internal Medicine (4,961 adults over 70): hazard ratio for serious fall injury "1.40 (95% CI, 1.03-1.90) in the moderate-intensity" antihypertensive group; "2.17" and "2.31" after a previous fall injury. [11] "I feel dizzy" after a blood-pressure dose is an escalation trigger.

## 6. Family caregivers

- AARP/NAC 2025: "63 million Americans" (nearly 1 in 4 adults) provided care, "an increase of 20 million from 2015 to 2025", with "over half managing complex medical and nursing tasks like injections, wound care, or medication management". [12]
- "More than 10 percent live an hour or more away from their care recipient." [13]
- Pew: "A quarter of U.S. adults are now part of the so-called 'sandwich generation'"; among those in their 40s, "More than half in this age group (54%)". [14] The dashboard is built for this remote, time-squeezed caregiver.

## 7. Voice assistants and older adults

- AARP: adults 50+ own a "home assistant (35 percent)". [15]
- JMIR 2021 (18 people 74+): first response "positive, thanks to the simplicity of a speech-based interaction", later soured over "the difficulty in constructing a structured sentence for a command". [16] Alexa+ natural language removes that barrier; guardrails use yes/no confirmations.
- JMIR 2025 randomized pilot (N=50, mean age 79, Alexa routines): "feasible to use as interventions with older adults." [17]

## 8. Amazon retired Alexa Together

- Amazon's own pages: "Update May 21, 2025: Alexa Together is no longer available. You can now subscribe to Alexa Emergency Assist for remote caregiver service." [18] It cost "$19.99 monthly or $199 annually"; "More than 25% of Alexa Together customers communicated across state lines". [18][19]
- Amazon documented the demand, then left it to an emergency-calling product with no medication-safety layer; no retrievable Amazon source states the exact end date.

## What the guardrails are NOT

- Not medical advice: it confirms intent and informs, never tells anyone to take, skip or change a medicine.
- Interaction table: informational, small, curated and cited; not clinical decision support.
- Escalation errs toward alerting a human; uncertainty goes up to family, never down to silence.
- No PHI: the demo runs on synthetic personas; nothing real is stored.

## Sources

All accessed 2026-09-19.

1. CDC/NCHS. https://www.cdc.gov/nchs/products/databriefs/db347.htm
2. AHRQ PSNet. https://psnet.ahrq.gov/primer/medication-errors-and-adverse-drug-events
3. JAMA 2021. https://jamanetwork.com/journals/jama/fullarticle/2784662
4. NEJM 2011 abstract. https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:22111719%20AND%20SRC:MED&resultType=core&format=json
5. CDC MMWR 2017. https://www.cdc.gov/mmwr/volumes/66/wr/mm6645a2.htm
6. Thromb Haemost 2020 abstract. https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:32455439%20AND%20SRC:MED&resultType=core&format=json
7. BMJ 2013 abstract. https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:23299844%20AND%20SRC:MED&resultType=core&format=json
8. CDC falls data. https://www.cdc.gov/falls/data-research/index.html
9. CDC MMWR 2023. https://www.cdc.gov/mmwr/volumes/72/wr/mm7235a1.htm
10. CDC STEADI. https://www.cdc.gov/steadi/media/pdfs/STEADI-FactSheet-MedsLinkedtoFalls-508.pdf
11. JAMA Intern Med 2014 abstract. https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:24567036%20AND%20SRC:MED&resultType=core&format=json
12. AARP/NAC 2025. https://www.aarp.org/press/releases/2025-07-24-new-report-reveals-crisis-point-for-americas-63-million-family-caregivers.html
13. AARP/NAC 2025, Living Situations. https://www.caregivingintheus.org/reports/living-situations/
14. Pew (updated 2026-08-27). https://www.pewresearch.org/short-reads/2022/04/08/more-than-half-of-americans-in-their-40s-are-sandwiched-between-an-aging-parent-and-their-own-children/
15. AARP 2025 Tech Trends. https://www.aarp.org/pri/topics/technology/internet-media-devices/2025-technology-trends-older-adults/
16. JMIR mHealth 2021 abstract. https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:33439130%20AND%20SRC:MED&resultType=core&format=json
17. JMIR Form Res 2025 abstract. https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.2196/64763&resultType=core&format=json
18. Amazon. https://www.aboutamazon.com/news/devices/alexa-together-launches-to-help-customers-remotely-care-for-loved-ones
19. Amazon. https://www.aboutamazon.com/news/devices/alexa-together-is-helping-bridge-the-miles-between-families

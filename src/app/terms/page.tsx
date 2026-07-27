import { LegalDocument, Placeholder } from "@/components/legal/legal-document";
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from "@/lib/legal/versions";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalDocument
      title={
        <>
          B2B AI Dialer
          <br />
          Terms of Service
        </>
      }
      meta={
        <>
          Effective Date: <Placeholder>{TERMS_EFFECTIVE_DATE}</Placeholder> · Version {TERMS_VERSION}
        </>
      }
    >
      <p className="font-semibold">
        IMPORTANT: THESE TERMS CONTAIN AN ARBITRATION AGREEMENT, CLASS ACTION WAIVER, WARRANTY
        DISCLAIMERS, LIABILITY LIMITATIONS, AND TELEMARKETING COMPLIANCE OBLIGATIONS.
      </p>

      <p>
        These Terms of Service (the &ldquo;Terms&rdquo;) are a binding agreement between the
        business or organization creating an account or using the Services (&ldquo;Customer,&rdquo;
        &ldquo;you,&rdquo; or &ldquo;your&rdquo;) and{" "}
        <Placeholder>[AI AT WORK LEGAL ENTITY NAME]</Placeholder>, doing business as AI AT WORK
        (&ldquo;AI AT WORK,&rdquo; &ldquo;Provider,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;). By checking the acceptance box, clicking &ldquo;Create Account,&rdquo;
        accessing the Services, or allowing any user to access the Services on your behalf, you
        agree to these Terms and represent that you have authority to bind Customer.
      </p>

      <h2>1. Eligibility, Business Use, and Authority</h2>
      <p>
        The Services are offered solely for legitimate business use. You must be at least 18 years
        old and legally able to enter contracts. If you use the Services for a company, client,
        employer, or other entity, you represent that you are authorized to bind that entity. You
        may not create an account using false identity, ownership, or contact information.
      </p>

      <h2>2. Services and Customer-Controlled Use</h2>
      <p>
        AI AT WORK provides hosted dialer, customer relationship management, call routing,
        analytics, recording, transcription, AI-assisted notes, automation, integration, support,
        and related functionality that may change over time (collectively, the &ldquo;Services&rdquo;).
        AI AT WORK provides technology access and support. Customer independently determines
        whether, when, where, why, and how to use the Services, including the recipients, calling
        lists, campaigns, scripts, offers, schedules, agents, dialing modes, and consent standards.
      </p>
      <p>
        The label &ldquo;B2B AI Dialer&rdquo; describes the intended commercial use of the product.
        It is not a legal determination that every call is business-to-business, exempt, or lawful.
        Customer is responsible for classifying every campaign and recipient correctly.
      </p>

      <h2>3. Account Registration and Security</h2>
      <p>
        You must provide complete and accurate account, billing, and business information and keep
        it current. You are responsible for all activity under your account, including activity by
        employees, contractors, representatives, affiliates, and anyone using your credentials. You
        must use reasonable security controls, protect passwords and API keys, and promptly notify
        AI AT WORK of suspected unauthorized access. Accounts may not be sold, shared outside
        Customer, or used as a service bureau without written approval.
      </p>

      <h2>4. Fees, Subscription, and Usage Credits</h2>
      <p>
        Subscription fees, onboarding fees, seat fees, usage-credit charges, carrier charges,
        phone-number costs, third-party fees, taxes, and any other commercial terms are shown in
        the applicable order form, checkout page, invoice, or service agreement. Unless expressly
        stated otherwise:
      </p>
      <ul>
        <li>
          Fees are stated in U.S. dollars and are nonrefundable once charged, except where required
          by law or expressly agreed in writing.
        </li>
        <li>
          Subscriptions renew automatically for successive billing periods until canceled in
          accordance with the applicable order or account controls.
        </li>
        <li>
          Usage credits are separate from subscription or retainer fees and may be required before
          calls, messages, recordings, transcription, AI processing, or other metered functions can
          be used.
        </li>
        <li>
          Customer authorizes AI AT WORK and its payment processor to charge the payment method on
          file for recurring fees, approved usage purchases, taxes, and past-due amounts.
        </li>
        <li>
          AI AT WORK may suspend calling or other metered functionality when credits are exhausted,
          payments fail, invoices become past due, or risk limits are reached.
        </li>
        <li>
          Unused credits are governed by the applicable order form. Credits are not cash, are not
          transferable, and may expire if the order form says so.
        </li>
      </ul>
      <p>
        Customer must review invoices and usage statements promptly and report a good-faith dispute
        within 15 days after the charge or invoice date. Undisputed past-due amounts may accrue the
        lesser of 1.5% per month or the maximum lawful rate, plus reasonable collection costs.
      </p>

      <h2>5. Telemarketing and Communications Compliance</h2>
      <p className="font-semibold">
        THIS SECTION IS MATERIAL TO YOUR RIGHT TO USE THE SERVICES. CUSTOMER, NOT AI AT WORK, IS THE
        CALLER, SENDER, TELEMARKETER, SELLER, AND CAMPAIGN OPERATOR FOR COMMUNICATIONS INITIATED
        THROUGH CUSTOMER&rsquo;S ACCOUNT, EXCEPT TO THE LIMITED EXTENT THE PARTIES EXPRESSLY AGREE
        OTHERWISE IN A SIGNED WRITING.
      </p>

      <h3>5.1 General Compliance Duty</h3>
      <p>
        Customer must comply with all federal, state, provincial, local, industry, carrier, and
        self-regulatory requirements applicable to calls, texts, prerecorded messages, artificial or
        AI-generated voices, recordings, lead generation, advertising, sales, and data use. These may
        include the Telephone Consumer Protection Act (TCPA), FCC rules and orders, Telemarketing
        Sales Rule (TSR), National Do Not Call requirements, state mini-TCPA and telemarketing laws,
        caller-ID laws, CAN-SPAM where applicable, privacy laws, call-recording consent laws, and
        carrier or messaging-program rules.
      </p>

      <h3>5.2 Consent and Permission</h3>
      <p>
        Before initiating any communication, Customer must determine whether consent is required and
        obtain the legally sufficient level of consent for the specific number, technology, content,
        caller, seller, and purpose. Customer must not rely on generic, stale, purchased, bundled,
        fabricated, unverifiable, or improperly transferred consent. Where prior express written
        consent is required, Customer must retain the complete consent language, timestamp, source
        URL or form, IP address or other audit data, consumer identity, phone number, named seller or
        caller where required, and proof that consent was not a condition of purchase where
        applicable.
      </p>

      <h3>5.3 Artificial, Prerecorded, and AI-Generated Voices</h3>
      <p>
        Customer acknowledges that AI-generated or voice-cloned speech may be treated as an
        artificial or prerecorded voice under applicable law. Customer may enable such functionality
        only after confirming that the call type is lawful and all required consent, identification,
        disclosure, opt-out, abandonment, recordkeeping, and calling-time requirements are satisfied.
        Customer may not impersonate a person, misrepresent identity, conceal the commercial nature of
        a call, or use a voice without all necessary rights and permissions.
      </p>

      <h3>5.4 Do Not Call and Opt-Out Controls</h3>
      <p>
        Customer must maintain and honor an internal company-specific Do Not Call list, suppress
        numbers that revoke consent or request no further contact, and scrub against federal and
        state registries when required. Customer must process revocations and opt-outs through any
        reasonable method permitted by law and must not obstruct, condition, or ignore them.
        Suppression records must be uploaded or applied before each campaign and retained for the
        legally required period.
      </p>

      <h3>5.5 Business-to-Business Campaigns</h3>
      <p>
        Customer may not assume that a call is exempt merely because Customer sells to businesses,
        labels a list as B2B, or believes the recipient works for a business. Mobile numbers,
        home-based businesses, mixed-use lines, calls involving consumer goods or services, and
        particular state laws may create additional obligations. Customer must independently verify
        the status and lawful treatment of each campaign and number.
      </p>

      <h3>5.6 Calling Times, Disclosures, Caller ID, and Conduct</h3>
      <p>
        Customer must comply with applicable calling-hour limits and required disclosures; transmit
        accurate caller identification; identify the caller and seller; describe the purpose of the
        call truthfully; avoid misleading claims; and provide any required callback number or
        opt-out mechanism. Customer may not spoof, falsify, rotate, or manipulate caller ID to
        deceive recipients or evade blocking, complaints, enforcement, or carrier controls. Customer
        may not engage in harassment, repeated unwanted calls, abusive conduct, deceptive sales
        practices, or abandonment rates above applicable limits.
      </p>

      <h3>5.7 Recording, Monitoring, Transcription, and AI Notes</h3>
      <p>
        Customer is solely responsible for obtaining all notices and consents required to record,
        monitor, transcribe, summarize, analyze, store, or disclose calls. Customer must account for
        all-party consent jurisdictions and must configure announcements or agent scripts
        accordingly. Customer must review AI-generated notes, summaries, dispositions, transcripts,
        and recommendations before relying on them; they may contain errors or omissions.
      </p>

      <h3>5.8 Lead Lists and Data Provenance</h3>
      <p>
        Customer represents that it lawfully obtained every lead, number, script, recording, voice,
        and dataset uploaded or used with the Services and has all rights necessary to process and
        contact the individuals or businesses involved. Customer must maintain auditable lead-source
        and consent records. AI AT WORK may request evidence and may reject, quarantine, limit, or
        remove lists that present legal, fraud, quality, security, or carrier risk.
      </p>

      <h3>5.9 Customer Compliance Program</h3>
      <p>
        Customer must maintain written policies, agent training, supervision, complaint handling,
        opt-out processing, list-suppression procedures, consent retention, quality assurance, and
        legal review reasonably appropriate to its campaigns. Customer must promptly investigate
        complaints and cooperate with reasonable compliance inquiries from AI AT WORK, carriers,
        service providers, or authorities.
      </p>

      <h2>6. Prohibited Uses</h2>
      <p>You may not use the Services to:</p>
      <ul>
        <li>Violate law, regulation, court order, carrier policy, contractual restriction, or another person&rsquo;s rights.</li>
        <li>
          Contact emergency lines, hospitals, healthcare facilities where prohibited, public-safety
          answering points, government emergency numbers, or numbers that should not receive
          automated traffic.
        </li>
        <li>
          Conduct scams, fraud, impersonation, phishing, deceptive lead generation, illegal debt
          collection, unlawful credit repair, unlawful health or insurance marketing, or other
          restricted activity.
        </li>
        <li>
          Promote illegal products or services, discriminatory practices, threats, harassment, hate,
          exploitation, or content that creates a material safety risk.
        </li>
        <li>Evade consent, Do Not Call, opt-out, caller-ID, registration, identity-verification, carrier, or platform controls.</li>
        <li>
          Probe, disrupt, overload, reverse engineer, copy, scrape, resell, sublicense, or gain
          unauthorized access to the Services, except where such restriction is prohibited by law.
        </li>
        <li>
          Upload malware, stolen data, sensitive personal data not reasonably necessary for the
          Services, or data you lack authority to process.
        </li>
      </ul>

      <h2>7. Monitoring, Verification, and Suspension</h2>
      <p>
        AI AT WORK may monitor platform activity, traffic patterns, complaint indicators, usage
        volume, recordings, metadata, and account information as reasonably necessary to operate,
        secure, support, bill, and protect the Services and its providers. AI AT WORK may request
        identity, business, campaign, consent, lead-source, script, registration, or compliance
        documentation. We may limit, pause, block, or terminate any account, campaign, number,
        feature, or integration immediately where we reasonably believe there is legal, security,
        fraud, carrier, reputational, payment, or operational risk. Such action does not transfer
        Customer&rsquo;s compliance responsibility to AI AT WORK.
      </p>

      <h2>8. Customer Data and Privacy</h2>
      <p>
        As between the parties, Customer retains its rights in data Customer submits to the Services
        (&ldquo;Customer Data&rdquo;). Customer grants AI AT WORK and its subprocessors a
        nonexclusive right to host, process, transmit, reproduce, and use Customer Data as necessary
        to provide, secure, maintain, support, analyze, and improve the Services and to comply with
        law. Customer is responsible for providing legally required privacy notices, identifying an
        appropriate legal basis, honoring data-subject rights, minimizing data, and executing any
        required data-processing agreement. Customer must not submit protected health information,
        payment-card data, government identification numbers, or other specially regulated data
        unless AI AT WORK has expressly authorized that use in writing.
      </p>
      <p>
        AI AT WORK may create and use aggregated or de-identified data that does not reasonably
        identify Customer or an individual. Our separate Privacy Policy, when posted or provided,
        describes our handling of personal information and is incorporated by reference.
      </p>

      <h2>9. Third-Party Services and Telecommunications Providers</h2>
      <p>
        The Services may rely on telecommunications carriers, cloud providers, AI vendors, payment
        processors, data providers, integrations, and other third parties. Their terms, availability,
        acceptable-use rules, pricing, and technical limits may apply. AI AT WORK does not control
        third-party networks and is not responsible for carrier blocking, spam labeling, number
        reputation, delivery failure, outages, rate changes, rejected registrations, or third-party
        acts or omissions. Customer authorizes AI AT WORK to share necessary account and traffic
        information with such providers for service delivery, compliance, security, and
        troubleshooting.
      </p>

      <h2>10. Intellectual Property and License</h2>
      <p>
        AI AT WORK and its licensors own the Services, software, workflows, documentation,
        interfaces, designs, models, configurations, and related intellectual property. Subject to
        these Terms and payment of all fees, AI AT WORK grants Customer a limited, nonexclusive,
        nontransferable, nonsublicensable, revocable right during the subscription term to use the
        Services internally for Customer&rsquo;s lawful business operations. No source code,
        ownership, or implied license is transferred. Feedback may be used by AI AT WORK without
        restriction or compensation, provided it does not identify Customer publicly without
        permission.
      </p>

      <h2>11. Service Changes, Beta Features, and Availability</h2>
      <p>
        We may modify, add, remove, replace, or discontinue features and may impose reasonable
        technical or usage limits. Beta, preview, experimental, or AI features are provided for
        evaluation, may be inaccurate or unavailable, and may be changed or withdrawn at any time.
        Unless an order form expressly states a service-level commitment, the Services are provided
        without guaranteed uptime, delivery, connect rate, appointment volume, conversion rate,
        revenue, lead quality, carrier acceptance, or business result.
      </p>

      <h2>12. No Legal Advice or Compliance Certification</h2>
      <p>
        AI AT WORK does not provide legal advice and does not certify that Customer&rsquo;s
        campaigns, lists, scripts, consent records, dialing configurations, offers, or business
        practices are lawful. Platform settings, templates, warnings, blocking, training, or support
        are operational tools only. Customer must obtain advice from qualified counsel familiar with
        the jurisdictions, industries, technologies, and campaign types involved.
      </p>

      <h2>13. Disclaimer of Warranties</h2>
      <p className="font-semibold">
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICES ARE PROVIDED &ldquo;AS IS&rdquo; AND
        &ldquo;AS AVAILABLE.&rdquo; AI AT WORK DISCLAIMS ALL EXPRESS, IMPLIED, STATUTORY, AND OTHER
        WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE,
        NON-INFRINGEMENT, ACCURACY, QUIET ENJOYMENT, AND WARRANTIES ARISING FROM COURSE OF DEALING OR
        USAGE OF TRADE. AI AT WORK DOES NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED,
        ERROR-FREE, SECURE, COMPLIANT FOR CUSTOMER&rsquo;S PARTICULAR USE, OR FREE FROM HARMFUL
        COMPONENTS.
      </p>

      <h2>14. Indemnification</h2>
      <p>
        Customer will defend, indemnify, and hold harmless AI AT WORK, its affiliates, owners,
        officers, employees, contractors, licensors, carriers, vendors, and service providers from
        claims, demands, investigations, actions, damages, judgments, settlements, fines, penalties,
        assessments, losses, costs, and reasonable attorneys&rsquo; fees arising out of or related
        to: (a) Customer&rsquo;s communications, campaigns, products, services, scripts, offers,
        recordings, data, or use of the Services; (b) violation of these Terms or applicable law; (c)
        absence, invalidity, or insufficiency of consent; (d) Do Not Call, opt-out, caller-ID,
        recording, privacy, advertising, or telemarketing claims; (e) Customer Data or lead sources;
        or (f) acts or omissions of Customer&rsquo;s users, agents, clients, affiliates, or
        contractors. AI AT WORK may control the defense with counsel of its choice, and Customer may
        not settle a claim imposing liability, admission, restriction, or obligation on AI AT WORK
        without written consent.
      </p>

      <h2>15. Limitation of Liability</h2>
      <p className="font-semibold">
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, AI AT WORK AND ITS AFFILIATES, OWNERS, EMPLOYEES,
        CONTRACTORS, LICENSORS, CARRIERS, AND VENDORS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL,
        SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES; LOST PROFITS, REVENUE, DATA,
        GOODWILL, LEADS, SALES, OR BUSINESS; COSTS OF SUBSTITUTE SERVICES; OR REGULATORY FINES OR
        THIRD-PARTY TELEMARKETING CLAIMS, EVEN IF ADVISED OF THE POSSIBILITY.
      </p>
      <p className="font-semibold">
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE TOTAL AGGREGATE LIABILITY OF AI AT WORK ARISING
        OUT OF OR RELATING TO THE SERVICES OR THESE TERMS WILL NOT EXCEED THE AMOUNTS ACTUALLY PAID
        BY CUSTOMER TO AI AT WORK FOR THE SERVICES DURING THE THREE MONTHS IMMEDIATELY BEFORE THE
        EVENT GIVING RISE TO THE CLAIM. THE LIMITATIONS APPLY REGARDLESS OF THEORY OF LIABILITY AND
        EVEN IF A REMEDY FAILS OF ITS ESSENTIAL PURPOSE.
      </p>

      <h2>16. Term, Cancellation, and Termination</h2>
      <p>
        These Terms begin when Customer accepts them and continue while Customer has an account or
        uses the Services. Customer may cancel as provided in the applicable order form or account
        controls. Cancellation stops future renewal but does not erase accrued fees, usage charges,
        commitments, or liabilities. AI AT WORK may terminate or suspend access for breach,
        nonpayment, legal or carrier risk, security concerns, inactivity, discontinuation of the
        Services, or any reason permitted by the applicable order form. Upon termination, Customer
        must stop using the Services and pay all outstanding amounts. Sections that by their nature
        should survive will survive, including payment, compliance, data rights, intellectual
        property, disclaimers, indemnity, liability limitations, dispute resolution, and
        miscellaneous terms.
      </p>

      <h2>17. Dispute Resolution, Arbitration, and Class Waiver</h2>
      <p>
        Before filing a claim, the complaining party must send written notice describing the dispute
        and requested relief and allow 30 days for informal resolution. Notices to AI AT WORK must be
        sent to <Placeholder>[LEGAL NOTICE EMAIL]</Placeholder> and{" "}
        <Placeholder>[LEGAL NOTICE ADDRESS]</Placeholder>.
      </p>
      <p>
        Except for eligible small-claims matters or actions seeking temporary injunctive relief for
        unauthorized access or intellectual-property misuse, any dispute arising out of or relating
        to these Terms or the Services will be resolved by confidential, binding, individual
        arbitration administered by the American Arbitration Association under its applicable
        Commercial Arbitration Rules. The Federal Arbitration Act governs this provision. The
        arbitration will take place in Miami-Dade County, Florida, remotely if the arbitrator
        permits, and judgment may be entered in any court of competent jurisdiction.
      </p>
      <p className="font-semibold">
        EACH PARTY WAIVES THE RIGHT TO A JURY TRIAL AND TO PARTICIPATE IN A CLASS, COLLECTIVE,
        CONSOLIDATED, MASS, OR REPRESENTATIVE ACTION OR ARBITRATION. CLAIMS MAY BE BROUGHT ONLY IN AN
        INDIVIDUAL CAPACITY.
      </p>
      <p>
        If this class waiver is found unenforceable for a particular claim, that claim must proceed
        in court and not in arbitration.
      </p>
      <p>
        Customer may opt out of arbitration by emailing <Placeholder>[LEGAL NOTICE EMAIL]</Placeholder>{" "}
        within 30 days after first accepting these Terms. The opt-out must identify Customer, the
        account email, and an explicit request to opt out. Opting out does not affect the remaining
        Terms.
      </p>

      <h2>18. Governing Law and Venue</h2>
      <p>
        Except to the extent governed by the Federal Arbitration Act or preempted by federal law,
        these Terms are governed by Florida law without regard to conflict-of-law rules. For disputes
        permitted to proceed in court, the parties consent to exclusive jurisdiction and venue in the
        state and federal courts located in Miami-Dade County, Florida.
      </p>

      <h2>19. Changes to These Terms</h2>
      <p>
        AI AT WORK may update these Terms by posting or presenting a revised version and changing the
        effective date. Material changes may be communicated through the account, email, or another
        reasonable method. Where required, continued use or a new affirmative acceptance will be
        requested. Continued use after the effective date of an update constitutes acceptance to the
        extent permitted by law. Changes do not retroactively alter disputes that arose before the
        updated Terms became effective.
      </p>

      <h2>20. Electronic Communications and Notices</h2>
      <p>
        Customer consents to receive agreements, disclosures, invoices, notices, and other
        communications electronically. Customer is responsible for keeping account contact
        information current. Operational notices may be sent through the Services or to the account
        email. Legal notices to AI AT WORK must be sent to the contact information below and are
        effective upon confirmed receipt.
      </p>

      <h2>21. Miscellaneous</h2>
      <p>
        These Terms, the applicable order form, service agreement, Privacy Policy, data-processing
        agreement, and documents expressly incorporated by reference form the entire agreement
        regarding the Services. If there is a conflict, a signed order form or service agreement
        controls only for the specific conflicting commercial term; these platform-wide compliance
        and acceptable-use obligations remain in effect unless expressly overridden in a signed
        writing. Customer may not assign these Terms without AI AT WORK&rsquo;s written consent. AI
        AT WORK may assign them in connection with a merger, financing, reorganization, sale, or
        transfer of the Services or business. Failure to enforce a provision is not a waiver. If a
        provision is unenforceable, it will be modified to the minimum extent necessary and the
        remainder will remain effective. The parties are independent contractors. Headings are for
        convenience only. &ldquo;Including&rdquo; means &ldquo;including without limitation.&rdquo;
      </p>

      <h2>22. Contact Information</h2>
      <p>
        <Placeholder>[AI AT WORK LEGAL ENTITY NAME]</Placeholder>
        <br />
        Attn: Legal
        <br />
        <Placeholder>[MAILING ADDRESS]</Placeholder>
        <br />
        Email: <Placeholder>[LEGAL NOTICE EMAIL]</Placeholder>
        <br />
        Support: <Placeholder>[SUPPORT EMAIL]</Placeholder>
      </p>
    </LegalDocument>
  );
}

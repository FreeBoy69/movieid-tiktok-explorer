import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { ReactNode } from "react";
import { BrandLogo } from "./BrandLogo";

const contactEmail = "evanslockwood69@gmail.com";
const effectiveDate = "April 27, 2026";

export function LegalPage({ type }: { type: "privacy" | "terms" }) {
  const isPrivacy = type === "privacy";

  return (
    <main className="min-h-dvh overflow-x-clip bg-[#F9F8F6] text-[#1A1A1A]">
      <header className="border-b border-[#1A1A1A]/6 bg-[#F9F8F6]/92 backdrop-blur">
        <nav className="mx-auto flex min-h-[68px] max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:px-5 md:min-h-[72px] md:px-8">
          <a href="/" className="min-w-0" aria-label="AutoYT home">
            <BrandLogo className="h-14 w-16 sm:h-[4.2rem] sm:w-[4.8rem] md:h-[2.1rem] md:w-[7.7rem]" imageClassName="max-h-full max-w-full" />
          </a>
          <a href="/" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-3 py-2 text-xs font-bold leading-4 text-[#1A1A1A]/65 shadow-sm transition hover:border-[#FF0033]/30 hover:text-[#FF0033] sm:h-10 sm:min-h-10 sm:px-4">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Back home
          </a>
        </nav>
      </header>

      <article className="mx-auto max-w-5xl px-4 py-10 sm:px-5 md:px-8 md:py-16">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full border border-[#FF0033]/16 bg-white px-3 py-1.5 text-xs font-bold leading-5 text-[#CC0029] shadow-sm">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">Google verification information</span>
          </div>
          <h1 className="text-balance font-serif text-[clamp(2.75rem,14vw,4rem)] font-bold leading-tight tracking-tight">
            {isPrivacy ? "Privacy Policy" : "Terms of Service"}
          </h1>
          <p className="mt-4 text-sm font-semibold text-[#1A1A1A]/45">Effective date: {effectiveDate}</p>
          <p className="mt-6 text-base leading-7 text-[#1A1A1A]/62">
            {isPrivacy
              ? "This policy explains how AutoYT collects, uses, stores, and protects information when you use the app, including Google and YouTube account data."
              : "These terms explain the rules for using AutoYT, including connected Google and YouTube account features."}
          </p>
        </div>

        {isPrivacy ? <PrivacyContent /> : <TermsContent />}

        <section className="mt-10 rounded-2xl border border-[#1A1A1A]/8 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-bold">Contact</h2>
          <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/58">
            Questions, account deletion requests, and privacy requests can be sent to:
          </p>
          <a href={`mailto:${contactEmail}`} className="mt-4 inline-flex max-w-full items-center gap-2 rounded-xl bg-[#FFDE32] px-4 py-3 text-sm font-bold leading-5 text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white">
            <Mail className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-all">{contactEmail}</span>
          </a>
        </section>
      </article>
    </main>
  );
}

function PrivacyContent() {
  return (
    <div className="mt-10 space-y-5">
      <LegalSection title="Information we collect">
        <p>When you sign in with Google, AutoYT may collect your Google profile name, email address, profile image, Google account identifier, YouTube channel identifiers, channel title, channel thumbnail, channel handle, subscriber count, view count, video count, uploads playlist, and recent upload statistics.</p>
        <p>When you use app features, AutoYT may process YouTube search queries, channel research, saved workspace items, uploaded or fetched video files, transcript text, AI writing outputs, optimization results, niche research results, and related workspace settings.</p>
      </LegalSection>

      <LegalSection title="How we use information">
        <p>We use this information to authenticate you, connect your YouTube channels, let you switch between accounts, display channel analytics, analyze videos, generate research boards, create AI-assisted writing outputs, and provide the workspace features you request.</p>
        <p>We do not sell your personal information. We do not use Google user data for advertising.</p>
      </LegalSection>

      <LegalSection title="Google and YouTube API data">
        <p>AutoYT uses Google OAuth and YouTube API Services to access the YouTube account data you authorize. The app requests access so it can display channel details, channel statistics, and recent uploads for accounts you connect.</p>
        <p>AutoYT's use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.</p>
      </LegalSection>

      <LegalSection title="Storage and security">
        <p>Connected account records, OAuth tokens, saved workspace items, and workspace data may be stored in the app database so your workspace persists between sessions. Sessions are stored server-side and protected with signed cookies.</p>
        <p>We use reasonable technical safeguards to protect stored data, but no online system can be guaranteed to be perfectly secure.</p>
      </LegalSection>

      <LegalSection title="Sharing and disclosure">
        <p>We may share data with service providers only when needed to operate the app, such as hosting, database, authentication, AI analysis, and API providers. We may disclose information if required by law or to protect the app and users.</p>
      </LegalSection>

      <LegalSection title="Your choices and deletion">
        <p>You can stop using AutoYT at any time, disconnect Google access from your Google Account permissions page, or contact us to request deletion of your AutoYT account data and connected YouTube account records.</p>
        <p>You may also revoke app access at <a href="https://myaccount.google.com/permissions" className="font-bold text-[#FF0033] underline">Google Account Permissions</a>.</p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>We may update this policy as AutoYT changes. When we make material changes, we will update the effective date on this page.</p>
      </LegalSection>
    </div>
  );
}

function TermsContent() {
  return (
    <div className="mt-10 space-y-5">
      <LegalSection title="Using AutoYT">
        <p>AutoYT is a creator research and workflow application for YouTube idea discovery, video optimization, AI writing, connected channel analytics, and publishing preparation.</p>
        <p>You are responsible for using the app lawfully and for making sure you have the rights needed for any content, URLs, videos, or data you submit.</p>
      </LegalSection>

      <LegalSection title="Accounts and Google access">
        <p>You may sign in with Google and connect one or more YouTube accounts. You authorize AutoYT to access the Google and YouTube data shown on the consent screen and described in the Privacy Policy.</p>
        <p>You can revoke Google access at any time from your Google Account permissions page.</p>
      </LegalSection>

      <LegalSection title="YouTube API Services">
        <p>By using AutoYT features that connect to YouTube, you also agree to the <a href="https://www.youtube.com/t/terms" className="font-bold text-[#FF0033] underline">YouTube Terms of Service</a> and the <a href="https://policies.google.com/privacy" className="font-bold text-[#FF0033] underline">Google Privacy Policy</a>.</p>
      </LegalSection>

      <LegalSection title="Content and research outputs">
        <p>AutoYT may generate summaries, analysis, research scores, rewrite drafts, and recommendations using automated systems. These outputs can be incomplete or incorrect. You are responsible for reviewing results before relying on them or publishing content.</p>
      </LegalSection>

      <LegalSection title="Third-party services">
        <p>AutoYT may interact with Google, YouTube, AI providers, hosting providers, and other third-party services. AutoYT is not affiliated with Google or YouTube.</p>
      </LegalSection>

      <LegalSection title="Restrictions">
        <p>You may not use AutoYT to break laws, infringe intellectual property rights, attack or overload services, bypass access controls, share credentials, or misuse Google, YouTube, or third-party data.</p>
      </LegalSection>

      <LegalSection title="Service availability">
        <p>AutoYT is provided as-is. Features may change, break, or be removed. We do not guarantee uninterrupted availability, perfect accuracy, or compatibility with every third-party platform change.</p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>To the fullest extent permitted by law, AutoYT is not liable for indirect, incidental, special, consequential, or lost-profit damages arising from use of the app.</p>
      </LegalSection>
    </div>
  );
}

function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-3 space-y-3 break-words text-sm leading-7 text-[#1A1A1A]/60">{children}</div>
    </section>
  );
}

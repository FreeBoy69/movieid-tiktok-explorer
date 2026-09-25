import { Clapperboard, Film, Layers3, Sparkles } from "lucide-react";
import { PRODUCTION_PLAYBOOKS, PRODUCTION_PROFILES } from "../utils/productionProfiles.js";
import type { MainView } from "../utils/tiktokRoute";
import "./ProductionLab.css";

export function ProductionLab({ onOpen }: { onOpen: (view: MainView) => void }) {
  return (
    <section className="production-lab" aria-labelledby="production-lab-title">
      <div className="production-lab-head">
        <div>
          <span className="production-lab-kicker"><Sparkles size={14} /> Production system</span>
          <h2 id="production-lab-title">Plan once. Render consistently.</h2>
          <p>Shared delivery profiles and visual playbooks keep every scene on-brand.</p>
        </div>
        <Layers3 size={28} aria-hidden="true" />
      </div>
      <div className="production-lab-grid">
        <div className="production-lab-group">
          <span className="production-lab-label">Delivery profile</span>
          <div className="production-lab-options">
            {PRODUCTION_PROFILES.map((profile) => (
              <div className="production-lab-option" key={profile.id}>
                <strong>{profile.name}</strong>
                <span>{profile.aspect} · {profile.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="production-lab-group">
          <span className="production-lab-label">Visual playbook</span>
          <div className="production-lab-options">
            {PRODUCTION_PLAYBOOKS.slice(0, 3).map((playbook) => (
              <div className="production-lab-option" key={playbook.id}>
                <strong>{playbook.name}</strong>
                <span>{playbook.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="production-lab-actions">
        <button type="button" className="production-lab-button is-primary" onClick={() => onOpen("create")}><Film size={15} /> Create Video</button>
        <button type="button" className="production-lab-button" onClick={() => onOpen("drama")}><Clapperboard size={15} /> Create Drama</button>
      </div>
    </section>
  );
}

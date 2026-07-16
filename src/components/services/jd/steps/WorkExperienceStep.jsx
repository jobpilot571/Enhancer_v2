import FormField from '../../FormField'
import { emptyExperience, emptyProject, newId } from '../jdProjectModel'

export default function WorkExperienceStep({ project, onChange }) {
  const experiences = project.experiences || []
  const projects = project.projects || []

  function setExperiences(next) {
    onChange({ ...project, experiences: next })
  }

  function setProjects(next) {
    onChange({ ...project, projects: next })
  }

  function patchExp(index, field, value) {
    setExperiences(experiences.map((e, i) => (i === index ? { ...e, [field]: value } : e)))
  }

  function moveExp(index, dir) {
    const j = index + dir
    if (j < 0 || j >= experiences.length) return
    const next = [...experiences]
    ;[next[index], next[j]] = [next[j], next[index]]
    setExperiences(next)
  }

  function duplicateExp(index) {
    const copy = { ...experiences[index], id: newId('exp') }
    setExperiences([...experiences.slice(0, index + 1), copy, ...experiences.slice(index + 1)])
  }

  return (
    <div className="jd-step">
      <header className="jd-step__header">
        <h4 className="jd-step__title">Work Experience</h4>
        <p className="jd-step__desc">
          Enter companies for the new resume. Order is present → past after generation; you can reorder here too.
        </p>
      </header>

      {experiences.map((exp, index) => (
        <div key={exp.id} className="builder-company">
          <div className="jd-step__row-head">
            <h4 className="builder-company__title">Company {index + 1}</h4>
            <div className="jd-step__row-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => moveExp(index, -1)} disabled={index === 0}>
                Up
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => moveExp(index, 1)} disabled={index === experiences.length - 1}>
                Down
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => duplicateExp(index)}>
                Duplicate
              </button>
              {experiences.length > 1 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setExperiences(experiences.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="form-grid">
            <FormField label="Company name" value={exp.companyName} onChange={(e) => patchExp(index, 'companyName', e.target.value)} required />
            <FormField label="Job title" value={exp.jobTitle} onChange={(e) => patchExp(index, 'jobTitle', e.target.value)} required />
            <FormField label="Location" value={exp.location} onChange={(e) => patchExp(index, 'location', e.target.value)} placeholder="City, State or Remote" />
            <FormField label="Industry / domain" value={exp.domain} onChange={(e) => patchExp(index, 'domain', e.target.value)} />
            <FormField label="Start date" value={exp.startDate} onChange={(e) => patchExp(index, 'startDate', e.target.value)} placeholder="e.g. Jan 2022" required />
            <FormField
              label="End date"
              value={exp.endDate}
              onChange={(e) => patchExp(index, 'endDate', e.target.value)}
              placeholder="e.g. Present"
              disabled={exp.isCurrent}
            />
            <label className="form-field form-field--full jd-check">
              <input
                type="checkbox"
                checked={!!exp.isCurrent}
                onChange={(e) => patchExp(index, 'isCurrent', e.target.checked)}
              />
              Current position
            </label>
            <FormField label="Project name (optional)" value={exp.projectName} onChange={(e) => patchExp(index, 'projectName', e.target.value)} />
            <FormField label="Client name (optional)" value={exp.clientName} onChange={(e) => patchExp(index, 'clientName', e.target.value)} />
            <FormField label="Team size (optional)" value={exp.teamSize} onChange={(e) => patchExp(index, 'teamSize', e.target.value)} />
            <FormField
              label="Main responsibilities"
              rows={3}
              value={exp.responsibilities}
              onChange={(e) => patchExp(index, 'responsibilities', e.target.value)}
              className="form-field--full"
            />
            <FormField
              label="Tools used"
              value={exp.tools}
              onChange={(e) => patchExp(index, 'tools', e.target.value)}
              placeholder="Comma-separated"
            />
            <FormField
              label="Technologies used"
              value={exp.technologies}
              onChange={(e) => patchExp(index, 'technologies', e.target.value)}
              placeholder="Comma-separated"
            />
            <FormField
              label="Achievements"
              rows={3}
              value={exp.achievements}
              onChange={(e) => patchExp(index, 'achievements', e.target.value)}
              className="form-field--full"
            />
            <FormField
              label="Project description (optional)"
              rows={2}
              value={exp.projectDescription}
              onChange={(e) => patchExp(index, 'projectDescription', e.target.value)}
              className="form-field--full"
            />
          </div>
        </div>
      ))}

      <button type="button" className="btn btn--outline" onClick={() => setExperiences([...experiences, emptyExperience()])}>
        Add company
      </button>

      <h5 className="jd-step__subtitle">Projects (optional)</h5>
      {projects.map((proj, index) => (
        <div key={proj.id} className="builder-company">
          <div className="jd-step__row-head">
            <h4 className="builder-company__title">Project {index + 1}</h4>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setProjects(projects.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <div className="form-grid">
            <FormField
              label="Project name"
              value={proj.name}
              onChange={(e) => setProjects(projects.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)))}
            />
            <FormField
              label="Role"
              value={proj.role}
              onChange={(e) => setProjects(projects.map((p, i) => (i === index ? { ...p, role: e.target.value } : p)))}
            />
            <FormField
              label="Technologies"
              value={proj.technologies}
              onChange={(e) => setProjects(projects.map((p, i) => (i === index ? { ...p, technologies: e.target.value } : p)))}
              className="form-field--full"
            />
            <FormField
              label="Description"
              rows={2}
              value={proj.description}
              onChange={(e) => setProjects(projects.map((p, i) => (i === index ? { ...p, description: e.target.value } : p)))}
              className="form-field--full"
            />
            <FormField
              label="Responsibilities"
              rows={2}
              value={proj.responsibilities}
              onChange={(e) => setProjects(projects.map((p, i) => (i === index ? { ...p, responsibilities: e.target.value } : p)))}
              className="form-field--full"
            />
            <FormField
              label="Achievements"
              rows={2}
              value={proj.achievements}
              onChange={(e) => setProjects(projects.map((p, i) => (i === index ? { ...p, achievements: e.target.value } : p)))}
              className="form-field--full"
            />
          </div>
        </div>
      ))}
      <button type="button" className="btn btn--outline" onClick={() => setProjects([...projects, emptyProject()])}>
        Add project
      </button>
    </div>
  )
}

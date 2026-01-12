import { LuChevronDown } from "../components/icons.tsx";
import { ComponentType } from "preact";

interface SettingsNavProps {
  currentSection: string;
  currentLabel: string;
  sections: Array<
    {
      value: string;
      label: string;
      icon: ComponentType<{ size?: number }>;
      show?: boolean;
    }
  >;
}

export default function SettingsNav(
  { currentSection, currentLabel, sections }: SettingsNavProps,
) {
  return (
    <div class="dropdown dropdown-bottom w-full">
      <div
        tabIndex={0}
        role="button"
        class="btn btn-outline w-full justify-between"
      >
        <span>{currentLabel}</span>
        <LuChevronDown size={18} />
      </div>
      <ul
        tabIndex={0}
        class="dropdown-content menu bg-base-100 rounded-box z-[1] w-full p-2 shadow-lg border border-base-300 mt-2"
      >
        {sections.filter((s) => s.show !== false).map((section) => {
          const Icon = section.icon;
          return (
            <li>
              <a
                href={section.value}
                class={`hover:bg-base-200 ${
                  currentSection === section.value ? "active" : ""
                }`}
              >
                <Icon size={18} />
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

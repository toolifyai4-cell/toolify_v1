import React from "react";
import { Box, Text } from "ink";
import {
  PLUGIN_CATALOG,
  type PluginMeta,
  type PluginSettings,
  type PluginStats,
} from "./settings.js";
import { useTheme } from "../theme/ThemeContext.js";
import type { ThemeTokens } from "../agent/types.js";
import {
  RUFLO_MODULES,
  RUFLO_ROLES,
  SKILL_CATALOG,
  listInstalledSkills,
  rufloModuleEnabled,
  rufloRoleEnabled,
  skillDisplayList,
  skillEnabled,
  type SkillDomain,
} from "./plugins.js";

/** Dedicated drill-down sub-view (Option 1): main list vs full sub-screens. */
export type PluginsSubView = "main" | "agentSkills" | "ruflo";

export interface PluginsTabProps {
  readonly plugins: PluginSettings;
  readonly selectedIndex: number;
  readonly stats: PluginStats;
  /** Dedicated drill-down sub-view state owned by SettingsMenu. */
  readonly activeSubView?: PluginsSubView;
  readonly inspectIndex: number;
  readonly toolifyHome?: string;
}

export function pluginCheckbox(enabled: boolean): string {
  return enabled ? "[✓]" : "[ ]";
}

export function skillDomainOf(name: string): SkillDomain | "Extra" {
  const hit = SKILL_CATALOG.find((s) => s.name === name);
  return hit ? hit.domain : "Extra";
}

export function PluginsTab(props: PluginsTabProps): React.ReactElement {
  const { tokens } = useTheme();
  const subView: PluginsSubView = props.activeSubView ?? "main";
  if (subView === "agentSkills") return renderAgentSkillsSubView(props, tokens);
  if (subView === "ruflo") return renderRufloSubView(props, tokens);
  return renderMainView(props, tokens);
}

function TopRule({ tokens }: { tokens: ThemeTokens }): React.ReactElement {
  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={tokens.textMuted}
    />
  );
}

function renderMainView(props: PluginsTabProps, tokens: ThemeTokens): React.ReactElement {
  return (
    <Box flexDirection="column">
      <TopRule tokens={tokens} />
      {PLUGIN_CATALOG.map((plugin: PluginMeta, i: number) => {
        const on = props.plugins[plugin.id];
        const selected = i === props.selectedIndex;
        const marker = selected ? "\u25b8" : " ";
        return (
          <Box key={plugin.id} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row">
              <Box width={2} flexShrink={0}>
                <Text color={selected ? tokens.accent : undefined} bold={selected}>
                  {marker}
                </Text>
              </Box>
              <Box width={3} flexShrink={0}>
                <Text color={on ? tokens.success : tokens.textMuted} bold={selected}>
                  {pluginCheckbox(on)}
                </Text>
              </Box>
              <Box width={16} flexShrink={0}>
                <Text
                  color={selected ? tokens.accent : tokens.text}
                  bold={selected}
                  wrap="truncate"
                >
                  {plugin.name}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={selected ? tokens.text : tokens.textMuted} wrap="truncate">
                  {plugin.description}
                </Text>
              </Box>
            </Box>
            {/* Progressive disclosure: the sub-topic status line is only
                rendered for the highlighted row (accordion behavior). */}
            {selected ? (
              <Box paddingLeft={4}>
                <Text color={on ? tokens.success : tokens.textMuted}>
                  {"\u2514\u2500 "}
                  {subStatus(plugin.id, on, props.stats)}
                </Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
      <TopRule tokens={tokens} />
    </Box>
  );
}
function subStatus(
  id: PluginMeta["id"],
  on: boolean,
  stats: PluginStats,
): string {
  if (id === "ponytail" && on) {
    return (
      "Engine active \u00b7 " +
      stats.ponytailSavings.toLocaleString("en-US") +
      " tokens saved"
    );
  }
  if (id === "graphify" && on) {
    return (
      "Graph ready \u00b7 " +
      stats.graphifyNodeCount.toLocaleString("en-US") +
      " nodes indexed"
    );
  }
  if (id === "agentSkills" && on) {
    return stats.activeSkillsCount + " skills active \u2014 Enter to inspect";
  }
  if (id === "ruflo" && on) {
    return (
      "Swarm Engine active \u00b7 " +
      stats.rufloActiveWorkers +
      " active workers \u2014 Enter to inspect"
    );
  }
  if (id === "ponytail") return "Engine paused";
  if (id === "graphify") return "Indexing disabled";
  if (id === "ruflo") return "Engine idle";
  return "Skills disabled";
}
function renderAgentSkillsSubView(props: PluginsTabProps, tokens: ThemeTokens): React.ReactElement {
  const installed = listInstalledSkills(props.toolifyHome);
  const displaySkills = skillDisplayList(installed);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text bold color={tokens.primary}>{"Settings > Plugins > Agent Skills"}</Text>
        <Text dimColor>[Esc] Back</Text>
      </Box>
      <TopRule tokens={tokens} />
      {displaySkills.map((name, i) => {
        const on = skillEnabled(props.plugins, name);
        const selected = i === props.inspectIndex;
        const marker = selected ? "\u25b8" : " ";
        const meta = SKILL_CATALOG.find((s) => s.name === name);
        const domain: string = meta ? meta.domain : "Extra";
        const desc: string = meta ? meta.description : "Workspace-installed skill";
        return (
          <Box key={name} flexDirection="row">
            <Box width={2}>
              <Text color={selected ? tokens.accent : undefined} bold={selected}>
                {marker}
              </Text>
            </Box>
            <Box width={3} flexShrink={0}>
              <Text color={on ? tokens.success : tokens.textMuted} bold={selected}>
                {pluginCheckbox(on)}
              </Text>
            </Box>
            <Box width={14} flexShrink={0}>
              <Text color={selected ? tokens.accent : tokens.text} bold={selected} wrap="truncate">
                {name}
              </Text>
            </Box>
            <Box width={12} flexShrink={0}>
              <Text color={selected ? tokens.text : tokens.textMuted} wrap="truncate">
                {domain}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={selected ? tokens.text : tokens.textMuted} wrap="truncate">
                {desc}
              </Text>
            </Box>
          </Box>
        );
      })}
      <TopRule tokens={tokens} />
      <Box paddingX={1}>
        <Text dimColor>{"Space toggle \u00b7 Esc back"}</Text>
      </Box>
    </Box>
  );
}
function renderRufloSubView(props: PluginsTabProps, tokens: ThemeTokens): React.ReactElement {
  const roleStart = RUFLO_MODULES.length;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text bold color={tokens.primary}>{"Settings > Plugins > Ruflo"}</Text>
        <Text dimColor>[Esc] Back</Text>
      </Box>
      <TopRule tokens={tokens} />
      <Box paddingX={1}>
        <Text bold color={tokens.text}>{"MODULES"}</Text>
      </Box>
      {RUFLO_MODULES.map((mod, i) => {
        const on = rufloModuleEnabled(props.plugins, mod.id);
        const selected = i === props.inspectIndex;
        const marker = selected ? "\u25b8" : " ";
        return (
          <Box key={mod.id} flexDirection="row">
            <Box width={2}>
              <Text color={selected ? tokens.accent : undefined} bold={selected}>
                {marker}
              </Text>
            </Box>
            <Box width={3}>
              <Text color={on ? tokens.success : tokens.textMuted} bold={selected}>
                {pluginCheckbox(on)}
              </Text>
            </Box>
            <Box width={14}>
              <Text color={selected ? tokens.accent : tokens.text} bold={selected} wrap="truncate">
                {mod.id}
              </Text>
            </Box>
            <Box width={12} flexShrink={0}>
              <Text color={selected ? tokens.text : tokens.textMuted} wrap="truncate">
                {mod.category}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={selected ? tokens.text : tokens.textMuted} wrap="truncate">
                {mod.description}
              </Text>
            </Box>
          </Box>
        );
      })}
      <TopRule tokens={tokens} />
      <Box paddingX={1}>
        <Text bold color={tokens.text}>{"SUB-AGENT ROLES"}</Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{"Worker roles assigned to the swarm "}</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" paddingX={1}>
        {RUFLO_ROLES.map((role, j) => {
          const on = rufloRoleEnabled(props.plugins, role);
          const selected = roleStart + j === props.inspectIndex;
          return (
            <Box key={role} marginRight={2}>
              <Text
                color={selected ? tokens.accent : on ? tokens.success : tokens.textMuted}
                bold={selected}
                backgroundColor={selected ? tokens.surface : undefined}
              >
                {pluginCheckbox(on)} {role}
              </Text>
            </Box>
          );
        })}
      </Box>
      <TopRule tokens={tokens} />
      <Box paddingX={1}>
        <Text dimColor>{"Space toggle \u00b7 Esc back"}</Text>
      </Box>
    </Box>
  );
}

export default PluginsTab;

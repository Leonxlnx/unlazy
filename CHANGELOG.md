# Changelog

## 1.0.0 (2026-08-10)

Initial release.

- SKILL.md with the Depth Tree method as the core: estimate T once at the root, split binary N layers deep, every leaf gets the full T, iterate each leaf until a pass finds nothing to improve.
- Nine enforcement rules grounded in 2025-2026 research on model laziness, underthinking, overthinking, long-horizon degradation and context anxiety.
- Spec-compliant frontmatter (name, description, license, metadata) so the skill loads in Claude Code, OpenAI Codex CLI, Cursor and the skills CLI (`npx skills add Leonxlnx/unlazy`).
- README with install matrix, method explanation, and an annotated research list.

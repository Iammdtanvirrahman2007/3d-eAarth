# 3D eAarth 🌍

A Minecraft-style **voxel globe** generated entirely from a deterministic world seed.

## Current build

- 🌍 Spherical block-based Earth instead of a flat Minecraft world
- 🌱 Procedural continents, terrain height, mountains, forests, sand, rock and polar snow
- 🌊 Ocean blocks around the globe
- 🎲 Seed input + random seed button
- 🔁 The same seed recreates the same terrain
- 🧊 Instanced voxel rendering for a much lighter WebGL scene
- ✨ Procedural star field and subtle atmosphere
- 🖱️ Orbit, zoom and automatic rotation
- 📦 No texture/image assets required
- 🚀 Runs as a static GitHub Pages site

## Run

Open `index.html` from a static web server, or enable **GitHub Pages → Deploy from branch → main → / (root)**.

The Three.js modules are loaded from jsDelivr, so the page needs an internet connection unless the dependencies are later vendored locally.

## Roadmap

1. Real Minecraft-style chunk streaming on the sphere
2. Break/place blocks
3. Player gravity that always points away from the spherical core
4. Digging through the Earth and exiting on the opposite surface
5. Biome-specific trees, villages and structures
6. Seeded caves and underground layers
7. Save/load worlds
8. First-person multiplayer-ready architecture

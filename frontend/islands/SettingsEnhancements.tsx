import { useEffect } from "preact/hooks";
import { useTranslations } from "../i18n/context.tsx";

export default function SettingsEnhancements() {
  const { t } = useTranslations();
  useEffect(() => {
    // Highlight color sync
    const input = document.getElementById("highlight-input") as
      | HTMLInputElement
      | null;
    const swatch = document.getElementById("highlight-swatch") as
      | HTMLElement
      | null;
    const applyColor = (val: string) => {
      if (!val || !swatch) return;
      swatch.style.background = val;
    };
    const onInput = () => {
      if (!input) return;
      const val = input.value || "";
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) applyColor(val);
    };
    input?.addEventListener("input", onInput);

    // Logo URL validation
    const logoInput = document.getElementById("logo-input") as
      | HTMLInputElement
      | null;
    const logoErr = document.getElementById("logo-error") as HTMLElement | null;
    const logoPreview = document.getElementById("logo-preview") as
      | HTMLElement
      | null;
    const logoPreviewImg = document.getElementById("logo-preview-img") as
      | HTMLImageElement
      | null;
    const logoFileInput = document.getElementById("logo-file") as
      | HTMLInputElement
      | null;

    // Color extraction functions
    const extractColorsFromImage = (img: HTMLImageElement, src?: string) => {
      // Check if this is an SVG
      if (src && (src.includes("data:image/svg") || src.includes(".svg"))) {
        extractColorsFromSVG(src);
        return;
      }

      // Handle raster images (PNG, JPG, etc.)
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = Math.min(img.naturalWidth, 200);
      canvas.height = Math.min(img.naturalHeight, 200);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const colors = extractDominantColors(imageData.data, 5);
      displayColorSuggestions(colors);
    };

    const extractColorsFromSVG = async (src: string) => {
      try {
        let svgContent: string;

        if (src.startsWith("data:image/svg")) {
          // Extract SVG content from data URL
          const base64Content = src.split(",")[1];
          svgContent = atob(base64Content);
        } else {
          // Fetch SVG from URL
          const response = await fetch(src);
          svgContent = await response.text();
        }

        const colors = parseSVGColors(svgContent);
        displayColorSuggestions(colors);
      } catch (error) {
        console.warn("Failed to extract colors from SVG:", error);
        // Fallback to canvas method if SVG parsing fails
        const img = new Image();
        img.onload = () => extractColorsFromImage(img, "");
        img.src = src;
      }
    };

    const parseSVGColors = (svgContent: string): string[] => {
      const colorSet = new Set<string>();

      // Regular expressions to match color values in SVG
      const colorPatterns = [
        /fill="([^"]+)"/g,
        /stroke="([^"]+)"/g,
        /style="[^"]*fill:\s*([^;"]+)/g,
        /style="[^"]*stroke:\s*([^;"]+)/g,
        /stop-color="([^"]+)"/g,
      ];

      colorPatterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(svgContent)) !== null) {
          const color = match[1].trim();
          if (isValidColor(color)) {
            colorSet.add(normalizeColor(color));
          }
        }
      });

      return Array.from(colorSet).slice(0, 5);
    };

    const isValidColor = (color: string): boolean => {
      // Check for hex colors
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return true;
      // Check for named colors (basic check)
      const namedColors = [
        "red",
        "blue",
        "green",
        "yellow",
        "purple",
        "orange",
        "pink",
        "black",
        "white",
        "gray",
      ];
      if (namedColors.includes(color.toLowerCase())) return true;
      // Check for rgb/rgba
      if (/^rgb(a)?\(/.test(color)) return true;
      return false;
    };

    const normalizeColor = (color: string): string => {
      // Convert named colors to hex (basic mapping)
      const colorMap: { [key: string]: string } = {
        "red": "#ff0000",
        "blue": "#0000ff",
        "green": "#008000",
        "yellow": "#ffff00",
        "purple": "#800080",
        "orange": "#ffa500",
        "pink": "#ffc0cb",
        "black": "#000000",
        "white": "#ffffff",
        "gray": "#808080",
      };

      const lowerColor = color.toLowerCase();
      if (colorMap[lowerColor]) return colorMap[lowerColor];

      // If it's already a hex color, return as-is
      if (color.startsWith("#")) return color;

      // For rgb/rgba, convert to hex (simplified)
      const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (rgbMatch) {
        const r = parseInt(rgbMatch[1]);
        const g = parseInt(rgbMatch[2]);
        const b = parseInt(rgbMatch[3]);
        return rgbToHex(r, g, b);
      }

      return color;
    };

    const extractDominantColors = (
      data: Uint8ClampedArray,
      numColors: number,
    ): string[] => {
      // Collect all non-transparent pixels
      const pixels: [number, number, number][] = [];

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const alpha = data[i + 3];

        // Only include fully opaque or nearly opaque pixels
        if (alpha < 200) continue;

        // Skip near-white and near-black pixels (they're usually backgrounds)
        const brightness = (r + g + b) / 3;
        if (brightness > 240 || brightness < 15) continue;

        pixels.push([r, g, b]);
      }

      if (pixels.length === 0) return [];

      // Use k-means clustering to find dominant colors
      const clusters = kMeansClustering(
        pixels,
        Math.min(numColors, pixels.length),
      );

      // Convert to hex and return
      return clusters.map(([r, g, b]) =>
        rgbToHex(
          Math.round(r),
          Math.round(g),
          Math.round(b),
        )
      );
    };

    const kMeansClustering = (
      pixels: [number, number, number][],
      k: number,
    ): [number, number, number][] => {
      // Initialize centroids by selecting k random pixels
      const centroids: [number, number, number][] = [];
      const usedIndices = new Set<number>();

      while (centroids.length < k && centroids.length < pixels.length) {
        const idx = Math.floor(Math.random() * pixels.length);
        if (!usedIndices.has(idx)) {
          centroids.push([...pixels[idx]]);
          usedIndices.add(idx);
        }
      }

      // Run k-means iterations
      for (let iteration = 0; iteration < 10; iteration++) {
        // Assign each pixel to nearest centroid
        const clusters: [number, number, number][][] = Array(k).fill(null).map(
          () => [],
        );

        for (const pixel of pixels) {
          let minDist = Infinity;
          let closestCluster = 0;

          for (let i = 0; i < centroids.length; i++) {
            const dist = colorDistance(pixel, centroids[i]);
            if (dist < minDist) {
              minDist = dist;
              closestCluster = i;
            }
          }

          clusters[closestCluster].push(pixel);
        }

        // Update centroids to cluster means
        let changed = false;
        for (let i = 0; i < centroids.length; i++) {
          if (clusters[i].length === 0) continue;

          const sumR = clusters[i].reduce((sum, p) => sum + p[0], 0);
          const sumG = clusters[i].reduce((sum, p) => sum + p[1], 0);
          const sumB = clusters[i].reduce((sum, p) => sum + p[2], 0);

          const newCentroid: [number, number, number] = [
            sumR / clusters[i].length,
            sumG / clusters[i].length,
            sumB / clusters[i].length,
          ];

          if (colorDistance(centroids[i], newCentroid) > 1) {
            changed = true;
          }

          centroids[i] = newCentroid;
        }

        // If no centroids changed significantly, we've converged
        if (!changed) break;
      }

      // Sort by cluster size (most common colors first)
      const clusterSizes = centroids.map((centroid, i) => {
        const size = pixels.filter((pixel) => {
          let minDist = Infinity;
          let closest = -1;
          for (let j = 0; j < centroids.length; j++) {
            const dist = colorDistance(pixel, centroids[j]);
            if (dist < minDist) {
              minDist = dist;
              closest = j;
            }
          }
          return closest === i;
        }).length;
        return { centroid, size };
      });

      return clusterSizes
        .sort((a, b) => b.size - a.size)
        .map((item) => item.centroid);
    };

    const colorDistance = (
      c1: [number, number, number],
      c2: [number, number, number],
    ): number => {
      // Euclidean distance in RGB space
      const dr = c1[0] - c2[0];
      const dg = c1[1] - c2[1];
      const db = c1[2] - c2[2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };

    const rgbToHex = (r: number, g: number, b: number): string => {
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    };

    const displayColorSuggestions = (colors: string[]) => {
      const container = document.getElementById("color-suggestions");
      if (!container) return;

      container.classList.remove("hidden");
      const swatchesContainer = container.querySelector(
        "div:last-child",
      ) as HTMLElement;
      if (!swatchesContainer) return;

      swatchesContainer.innerHTML = "";

      colors.forEach((color) => {
        const swatch = document.createElement("button");
        swatch.className =
          "w-8 h-8 rounded border-2 border-base-300 hover:border-base-content transition-colors";
        swatch.style.backgroundColor = color;
        swatch.title = t("Click to set highlight color to {{color}}", {
          color,
        });
        swatch.addEventListener("click", () => {
          if (input) {
            input.value = color;
            applyColor(color);
          }
        });
        swatchesContainer.appendChild(swatch);
      });
    };

    const hideColorSuggestions = () => {
      const container = document.getElementById("color-suggestions");
      if (container) {
        container.classList.add("hidden");
        container.innerHTML = "";
      }
    };

    const isValidLogo = (v: string) => {
      if (!v) return true; // Empty is valid
      if (v.startsWith("data:image/")) return true;
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    };

    const updateLogoPreview = (src: string) => {
      if (logoPreview && logoPreviewImg && src) {
        logoPreviewImg.src = src;
        logoPreview.classList.remove("hidden");
        // Extract colors when image loads
        logoPreviewImg.onload = () =>
          extractColorsFromImage(logoPreviewImg, src);
      } else if (logoPreview) {
        logoPreview.classList.add("hidden");
        hideColorSuggestions();
      }
    };

    const updateLogo = () => {
      const v = (logoInput && logoInput.value) ? logoInput.value.trim() : "";
      if (!isValidLogo(v)) {
        logoErr && logoErr.classList.remove("hidden");
        updateLogoPreview("");
        return;
      }
      logoErr && logoErr.classList.add("hidden");
      updateLogoPreview(v);
    };

    const onLogoTyping = () => {
      logoErr && logoErr.classList.add("hidden");
    };

    // Handle file upload
    const onFileChange = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith("image/")) {
        alert(t("Please select a valid image file."));
        return;
      }

      // Validate file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        alert(t("File size must be less than 5MB."));
        return;
      }

      // Read file as base64
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (logoInput && result) {
          logoInput.value = result;
          updateLogo();
        }
      };
      reader.readAsDataURL(file);
    };

    logoInput?.addEventListener("change", updateLogo);
    logoInput?.addEventListener("input", onLogoTyping);
    logoFileInput?.addEventListener("change", onFileChange);

    if (logoInput?.value) updateLogo();

    return () => {
      input?.removeEventListener("input", onInput);
      logoInput?.removeEventListener("change", updateLogo);
      logoInput?.removeEventListener("input", onLogoTyping);
      logoFileInput?.removeEventListener("change", onFileChange);
    };
  }, [t]);
  return null;
}

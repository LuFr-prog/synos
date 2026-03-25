export default async (req, context) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Get API key from environment variable
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Clé API non configurée sur le serveur." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Get the raw notes from the request
  let notes;
  try {
    const body = await req.json();
    notes = body.notes;
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!notes || notes.trim().length === 0) {
    return new Response(JSON.stringify({ error: "Aucune note fournie." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // System prompt for geological structuring
  const systemPrompt = `Tu es un moteur de structuration pour données de sondage géotechnique suisse. Tu reçois des notes de terrain brutes — souvent abrégées, mal orthographiées, en syntaxe télégraphique — et tu les restructures en JSON exploitable.

RÈGLES ABSOLUES :
1. Tu ne fais QUE restructurer. Tu n'interprètes jamais. Tu n'ajoutes aucune information absente du texte original.
2. Si un élément est ambigu ou incertain, tu le marques "status": "verify" au lieu de "status": "ok".
3. Tu conserves la description brute originale dans le champ "raw" de chaque couche.
4. Tu normalises le vocabulaire selon la norme SN 670 009 : ordre = nature du matériau, couleur, granulométrie/texture, consistance, humidité, inclusions.
5. Tu estimes le code USCS quand c'est possible. Si incertain, tu mets "?" et status "verify".

ABRÉVIATIONS COURANTES À RECONNAÎTRE :
- tv, TV = terre végétale
- lim = limon, sabl = sableux, arg = argileux, grav = gravier/graveleux
- gr, grs = gris, br = brun, jr = jaunâtre, bg = beige, bl = bleu/bleuté, vr = vert/verdâtre
- dens = dense, comp = compact, mbl = meuble
- hum = humide, sat = saturé
- fluvioglac = fluvioglaciaire, qq = quelques
- mol = molasse, grés = gréseuse, marn = marneuse
- calc = calcaire, caillx = cailloux
- éch = échantillon, prél = prélevé
- NP, nappe = niveau piézométrique
- perm = perméable, imperméable
- aquif = aquifère
- moy = moyen
- gross = grossier

FORMAT DE SORTIE (JSON strict, rien d'autre) :
{
  "meta": {
    "id": "string ou null",
    "date": "string ou null",
    "lieu": "string ou null",
    "altitude": number ou null,
    "coord_e": "string ou null",
    "coord_n": "string ou null",
    "nappe_m": number ou null
  },
  "layers": [
    {
      "from": 0.0,
      "to": 0.3,
      "raw": "description brute originale telle que tapée",
      "description": "Description normée SN 670 009",
      "lithologie": "Nom de la lithologie principale",
      "uscs": "Code USCS",
      "status": "ok ou verify"
    }
  ],
  "observations": ["string"],
  "warnings": ["string si quelque chose est incohérent"]
}

IMPORTANT :
- Réponds UNIQUEMENT avec le JSON. Pas de texte avant, pas de texte après, pas de backticks markdown.
- Si les notes ne contiennent aucune donnée de sondage exploitable, retourne : {"error": "Aucune donnée de sondage détectée dans les notes fournies."}
- Les profondeurs doivent être des nombres (float), pas des strings.
- Les couches doivent être triées par profondeur croissante.
- Si une couche n'a pas de profondeur "à" claire, essaie de la déduire de la couche suivante. Si impossible, mets "to": null et "status": "verify".
- Les profondeurs en centimètres (ex: "0-50cm") doivent être converties en mètres (0.0-0.5).
- Traite "refus", "fin de forage", "arrêt" comme la fin du sondage, pas comme une couche.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: notes
          }
        ]
      })
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Erreur API: " + response.status }), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const data = await response.json();
    const text = data.content[0].text;

    // Try to parse as JSON to validate
    let jsonText = text;
    try {
      JSON.parse(text);
    } catch (e) {
      // Claude might have added backticks, try to clean
      jsonText = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      try {
        JSON.parse(jsonText);
      } catch (e2) {
        return new Response(JSON.stringify({ error: "La structuration a échoué. Réessayer." }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return new Response(jsonText, {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: "La structuration n'a pas abouti. Vérifier la connexion et réessayer." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export const config = {
  path: "/.netlify/functions/structurer"
};

const SYSTEM_PROMPT = `Tu es un géologue suisse expérimenté. Tu structures des notes de terrain brutes en un JSON normalisé selon SN 670 009.

RÈGLES GÉNÉRALES :
- Reconnais les abréviations géotechniques suisses : tv (terre végétale), lim (limon), sabl (sableux), grav (gravier), grs (gris), br (brun), bg (beige), dens (dense), comp (compact), fluvioglac (fluvioglaciaire), mol (molasse), arg (argileux/argile), calc (calcaire), etc.
- Convertis les profondeurs en centimètres vers des mètres si nécessaire
- Traite "refus", "fin de forage", "arrêt" comme fin de sondage
- Corrige les fautes évidentes et interprète les conventions personnelles
- Marque en "verify" tout élément ambigu où tu n'es pas confiant
- Ordre SN 670 009 pour la description : matériau principal, granulométrie, couleur, consistance/densité, humidité, inclusions, origine

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
  "columns": ["profondeur", "figure", "description", ...colonnes conditionnelles détectées],
  "layers": [
    {
      "from": 0.0,
      "to": 0.3,
      "raw": "description brute originale",
      "description": "Description normée SN 670 009 complète",
      "lithologie": "Nom de la lithologie principale seule",
      "couleur": "string ou null",
      "consistance": "string ou null",
      "humidite": "string ou null",
      "granulometrie": "string ou null",
      "inclusions": "string ou null",
      "uscs": "Code USCS",
      "status": "ok ou verify"
    }
  ],
  "observations": ["string"],
  "warnings": ["string"]
}

RÈGLES POUR LE CHAMP "columns" :
- Toujours inclure : "profondeur", "figure", "description", "uscs"
- Inclure "couleur" si au moins la moitié des couches mentionnent une couleur
- Inclure "consistance" si au moins la moitié des couches mentionnent une consistance
- Inclure "humidite" si au moins la moitié des couches mentionnent une humidité
- Inclure "granulometrie" si au moins la moitié des couches précisent la granulométrie
- Inclure "inclusions" si au moins la moitié des couches mentionnent des inclusions
- Inclure "altitude" si meta.altitude n'est pas null

RÈGLES POUR LES CHAMPS PAR COUCHE :
- "lithologie" contient UNIQUEMENT le nom principal (ex: "Gravier sableux", "Moraine de fond")
- "couleur" contient UNIQUEMENT la couleur (ex: "Gris beige", "Brun jaunâtre") ou null
- "consistance" contient UNIQUEMENT l'état (ex: "Dense", "Ferme", "Compact") ou null
- "humidite" contient UNIQUEMENT l'état (ex: "Sec", "Humide", "Saturé") ou null
- "granulometrie" contient UNIQUEMENT la granulométrie (ex: "Fin", "Moyen", "Grossier") ou null
- "inclusions" contient UNIQUEMENT les inclusions (ex: "Galets striés, blocs jusqu'à 30cm") ou null
- "description" contient la description normée COMPLÈTE SN 670 009 avec tous les éléments
- Ne PAS dupliquer les informations des champs séparés dans "description" — "description" est la version complète, les champs séparés sont des extractions
- "raw" contient la description brute originale telle que saisie par le géologue

Renvoie UNIQUEMENT le JSON, sans texte avant ni après.`;

const CORRECTION_SYSTEM_PROMPT = `Tu reçois un JSON structuré existant d'un sondage géotechnique et une instruction de correction du géologue.

Applique la correction demandée au JSON et renvoie le JSON complet mis à jour.
Ne modifie QUE ce qui est demandé. Tout le reste reste identique.
Si la correction impacte d'autres champs (ex: changer la lithologie impacte le code USCS, changer la profondeur impacte l'épaisseur), mets-les à jour aussi.
Recalcule le champ "columns" si nécessaire (mêmes règles que la structuration initiale).

Renvoie UNIQUEMENT le JSON corrigé, même format que l'original, sans texte avant ni après.`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const body = JSON.parse(event.body);

    let systemPrompt, userMessage;

    if (body.correction) {
      systemPrompt = CORRECTION_SYSTEM_PROMPT;
      userMessage = `JSON actuel :\n${JSON.stringify(body.correction.current, null, 2)}\n\nCorrection demandée :\n${body.correction.instruction}`;
    } else if (body.notes) {
      systemPrompt = SYSTEM_PROMPT;
      userMessage = body.notes;
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing 'notes' or 'correction' in request body" }) };
    }

    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      })
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text();
      throw new Error(`Anthropic API error ${apiResponse.status}: ${errBody}`);
    }

    const apiResult = await apiResponse.json();
    const text = apiResult.content[0].text.trim();

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const result = JSON.parse(jsonStr);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("Structurer error:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message || "Internal server error" }),
    };
  }
};

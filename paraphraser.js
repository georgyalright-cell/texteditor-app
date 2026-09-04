(function attachRuleParaphraser(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RuleParaphraser = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createRuleParaphraser() {
  "use strict";

  const WORD_RE = /[\p{L}\p{N}_-]+/gu;
  const URL_RE = /https?:\/\/[^\s<>()]+/giu;
  const NUMBER_RE = /\d+(?:[.,]\d+)?/g;
  const PROTECTED_RE = /https?:\/\/[^\s<>()]+|\[[^\]\n]{1,400}\]|«[^»\n]{0,1200}»|“[^”\n]{0,1200}”|"[^"\n]{0,1200}"|`[^`\n]+`/gu;

  // Заменяются только целые, грамматически самостоятельные обороты.
  // Отдельные слова по синонимам не подбираются: без морфологического
  // разбора это небезопасно, а в английском ещё и меняет регистр стиля.
  //
  // Цель набора — академический регистр отчёта: убрать разговорные формы,
  // канцелярскую воду и обороты, которыми language-модели выдают себя
  // (delve into, cutting-edge, plays a key role, It is important to note).

  const ACADEMIC_EN = [
    // Сокращённые формы недопустимы в академическом тексте.
    [/\bdon't\b/giu, ["do not"]],
    [/\bdoesn't\b/giu, ["does not"]],
    [/\bdidn't\b/giu, ["did not"]],
    [/\bisn't\b/giu, ["is not"]],
    [/\baren't\b/giu, ["are not"]],
    [/\bwasn't\b/giu, ["was not"]],
    [/\bweren't\b/giu, ["were not"]],
    [/\bcan't\b/giu, ["cannot"]],
    [/\bwon't\b/giu, ["will not"]],
    [/\bwouldn't\b/giu, ["would not"]],
    [/\bshouldn't\b/giu, ["should not"]],
    [/\bcouldn't\b/giu, ["could not"]],
    [/\bhasn't\b/giu, ["has not"]],
    [/\bhaven't\b/giu, ["have not"]],
    [/\bit's\b/giu, ["it is"]],
    [/\bthere's\b/giu, ["there is"]],
    [/\bthey're\b/giu, ["they are"]],
    [/\bwe're\b/giu, ["we are"]],
    [/\bwe'll\b/giu, ["we will"]],
    [/\blet's\b/giu, ["let us"]],

    // Вводные конструкции без содержания.
    [/\bit is important to note that\b/giu, ["notably,", "importantly,"]],
    [/\bit should be noted that\b/giu, ["notably,"]],
    [/\bit is worth noting that\b/giu, ["notably,"]],
    [/\bit is worth mentioning that\b/giu, ["notably,"]],
    [/\bit must be emphasi[sz]ed that\b/giu, ["critically,"]],
    [/\bit goes without saying that\b/giu, ["clearly,"]],
    [/\bneedless to say\b/giu, ["clearly"]],
    [/\bas a matter of fact\b/giu, ["in fact"]],

    // Канцелярская вода.
    [/\bdue to the fact that\b/giu, ["because"]],
    [/\bowing to the fact that\b/giu, ["because"]],
    [/\bin spite of the fact that\b/giu, ["although"]],
    [/\bdespite the fact that\b/giu, ["although"]],
    [/\bin the event that\b/giu, ["if"]],
    [/\bin order to\b/giu, ["to"]],
    [/\bfor the purpose of\b/giu, ["to"]],
    [/\bwith the exception of\b/giu, ["except for"]],
    [/\bat this point in time\b/giu, ["currently"]],
    [/\bat the present time\b/giu, ["currently"]],
    [/\bin the near future\b/giu, ["soon"]],
    [/\ba large number of\b/giu, ["many"]],
    [/\ba small number of\b/giu, ["few"]],
    [/\bthe majority of\b/giu, ["most"]],
    [/\ba wide range of\b/giu, ["various", "a range of"]],
    [/\bhas the ability to\b/giu, ["can"]],
    [/\bhave the ability to\b/giu, ["can"]],
    [/\bis able to\b/giu, ["can"]],
    [/\bare able to\b/giu, ["can"]],
    [/\btake into consideration\b/giu, ["consider"]],
    [/\bgive consideration to\b/giu, ["consider"]],
    [/\bconduct an analysis of\b/giu, ["analyse"]],
    [/\bperform an evaluation of\b/giu, ["evaluate"]],
    [/\bmake a decision\b/giu, ["decide"]],
    [/\bin close proximity to\b/giu, ["near"]],
    [/\bprior to\b/giu, ["before"]],
    [/\bsubsequent to\b/giu, ["after"]],
    [/\bon a regular basis\b/giu, ["regularly"]],
    [/\bin the majority of cases\b/giu, ["usually"]],

    // Обороты, которыми языковые модели выдают себя.
    [/\bdelve into\b/giu, ["examine", "analyse"]],
    [/\bdelves into\b/giu, ["examines", "analyses"]],
    [/\bdelving into\b/giu, ["examining"]],
    [/\bplays a key role\b/giu, ["is central"]],
    [/\bplays a crucial role\b/giu, ["is central"]],
    [/\bplays an important role\b/giu, ["is important"]],
    [/\ba testament to\b/giu, ["evidence of"]],
    [/\bcutting-edge\b/giu, ["advanced"]],
    [/\bstate-of-the-art\b/giu, ["advanced"]],
    [/\bgame-changing\b/giu, ["significant"]],
    [/\brevolutioni[sz]e\b/giu, ["transform"]],
    [/\bseamlessly\b/giu, ["smoothly"]],
    [/\bseamless\b/giu, ["smooth"]],
    [/\bleverages\b/giu, ["uses"]],
    [/\bleveraging\b/giu, ["using"]],
    [/\bleverage\b/giu, ["use"]],
    [/\butili[sz]ation\b/giu, ["use"]],
    [/\butili[sz]es\b/giu, ["uses"]],
    [/\butili[sz]ed\b/giu, ["used"]],
    [/\butili[sz]ing\b/giu, ["using"]],
    [/\butili[sz]e\b/giu, ["use"]],
    [/\bin the realm of\b/giu, ["in"]],
    [/\bin today's world\b/giu, ["currently"]],
    [/\bin today's fast-paced world\b/giu, ["currently"]],
    [/\bnavigate the complexities of\b/giu, ["address"]],
    [/\bunlock the potential of\b/giu, ["realise the potential of"]],
    [/\bholistic approach\b/giu, ["comprehensive approach"]],
    [/\bparadigm shift\b/giu, ["fundamental change"]],
    [/\bmoving forward\b/giu, ["in future periods"]],
    [/\bat the end of the day\b/giu, ["ultimately"]],

    // Связки в начале предложения: вариативная замена по образцу русской
    // пары «таким образом,». Полное снятие связки — работа пасса 21, здесь
    // задача скромнее: не дать всем абзацам начинаться одинаково.
    [/\bmoreover,/giu, ["In addition,", "Also,"], { variation: true }],
    [/\bfurthermore,/giu, ["In addition,", "Beyond that,"], { variation: true }],
    [/\badditionally,/giu, ["In addition,", "Also,"], { variation: true }],
    // Запасное правило для формы без глагола-связки: без него «well-positioned
    // to» поднимал бы оценку, не имея ни одной трансформации.
    [/\bwell-positioned to\b/giu, ["able to"]],

    // Ориентир регистра — деловой английский уровня B2-C1, как в методичке.
    // Это не упрощение ради упрощения: вычурная латинская лексика в деловом
    // тексте читается как переводная или машинная, а требование методички —
    // ясность. Разговорность при этом не вводится: никаких сокращённых форм,
    // никаких «get» и фразовых глаголов, регистр остаётся деловым.
    [/\bcommences\b/giu, ["begins"]],
    [/\bcommence\b/giu, ["begin"]],
    [/\bcommenced\b/giu, ["began"]],
    [/\bcommencement\b/giu, ["start"]],
    [/\bfacilitates\b/giu, ["supports"]],
    [/\bfacilitate\b/giu, ["support"]],
    [/\bfacilitated\b/giu, ["supported"]],
    [/\bdemonstrates\b/giu, ["shows"]],
    [/\bdemonstrate\b/giu, ["show"]],
    [/\bdemonstrated\b/giu, ["showed"]],
    [/\bendeavours\b/giu, ["aims"]],
    [/\bendeavour\b/giu, ["aim"]],
    [/\bterminates\b/giu, ["ends"]],
    [/\bterminate\b/giu, ["end"]],
    [/\bterminated\b/giu, ["ended"]],
    [/\bsufficient\b/giu, ["enough"]],
    [/\bnumerous\b/giu, ["many"]],
    [/\bapproximately\b/giu, ["about"]],
    [/\bwith regard to\b/giu, ["about"]],
    [/\bwith respect to\b/giu, ["about"]],
    [/\bin relation to\b/giu, ["about"]],
    [/\bsubsequently\b/giu, ["later"]],
    [/\ba number of\b/giu, ["several"]],
    [/\bascertain\b/giu, ["establish"]],
    [/\binitiates\b/giu, ["starts"]],
    [/\binitiate\b/giu, ["start"]],
    [/\binitiated\b/giu, ["started"]],
    [/\bendeavours to\b/giu, ["aims to"]],
    [/\bin the vicinity of\b/giu, ["near"]],
    [/\bnotwithstanding\b/giu, ["despite"]],
    [/\bheretofore\b/giu, ["until now"]],
    [/\bthereafter\b/giu, ["after that"]],

    // Диалект бизнес-плана. Замены только там, где оборот действительно
    // пустой: «comprehensive framework» — это framework, «proactive risk
    // management» — это risk management. Термины, за которыми стоит
    // содержание (value proposition, market segment), не трогаются.
    [/\ba comprehensive framework\b/giu, ["a framework"]],
    [/\bcomprehensive framework\b/giu, ["framework"]],
    [/\bproactive risk management\b/giu, ["risk management"]],
    [/\bstrategic goals\b/giu, ["goals"]],
    [/\bis well-positioned to\b/giu, ["can"]],
    [/\bare well-positioned to\b/giu, ["can"]],
    [/\bsignificant market share\b/giu, ["market share"]],
    [/\brigorous monitoring of\b/giu, ["monitoring of"]],
    [/\bthe structured implementation approach\b/giu, ["the implementation plan"]],
    [/\bstructured implementation approach\b/giu, ["implementation plan"]],
    [/\bin a dynamic environment\b/giu, ["as conditions change"]],
    [/\bdata-driven decision-making\b/giu, ["decisions based on data"]],
    [/\bkey stakeholders\b/giu, ["stakeholders"]],
    [/\bcore competencies\b/giu, ["strengths"]],
    [/\bthe competitive landscape\b/giu, ["the market"]],
    [/\bcompetitive landscape\b/giu, ["market"]],
    [/\bsignificant potential\b/giu, ["potential"]],
    [/\bplays a pivotal role\b/giu, ["is central"]],
    [/\bgoing forward\b/giu, ["in future periods"]],
    [/\ba robust solution\b/giu, ["a reliable solution"]],
    [/\brobust solution\b/giu, ["reliable solution"]],
    [/\bdrive significant\b/giu, ["increase"]],

    // Разговорные усилители.
    [/\ba lot of\b/giu, ["many"]],
    [/\blots of\b/giu, ["many"]],
    [/\bvery important\b/giu, ["critical"]],
    [/\bvery significant\b/giu, ["substantial"]],
    [/\bvery large\b/giu, ["substantial"]],
    [/\breally important\b/giu, ["important"]],
    [/\bpretty much\b/giu, ["largely"]],

    // Однообразные связки: варианты нужны, чтобы абзацы не начинались
    // одинаково — выбор детерминирован хэшем абзаца.
    [/\bFurthermore,/gu, ["In addition,", "Also,"], { variation: true }],
    [/\bMoreover,/gu, ["In addition,", "Also,"], { variation: true }],
    [/\bAdditionally,/gu, ["In addition,", "Also,"], { variation: true }],
    [/\bIn conclusion,/gu, ["Overall,", "To conclude,"], { variation: true }],
    [/\bIn summary,/gu, ["Overall,", "In brief,"], { variation: true }],
    [/\bThus,/gu, ["Therefore,", "Consequently,"], { variation: true }],
    [/\bHence,/gu, ["Therefore,", "As a result,"], { variation: true }],
  ];

  // Русский набор остаётся консервативным и академическим: он нужен
  // только когда прислан русский текст. Публицистики и научпопа здесь нет.
  const ACADEMIC_RU = [
    // Сначала идут длинные конструкции: короткие правила ниже не должны
    // перехватывать их по частям и оставлять канцелярский хвост.
    [/\bв современном мире важно отметить, что\b/giu, ["сейчас"]],
    [/\bтаким образом, можно сделать вывод о том, что\b/giu, ["следовательно,"]],
    [/\bтаким образом, можно сделать вывод, что\b/giu, ["следовательно,"]],
    [/\bподводя итог, можно сказать, что\b/giu, ["в итоге"]],
    [/\bможно сделать вывод о том, что\b/giu, ["отсюда следует, что"]],
    [/\bможно сделать вывод, что\b/giu, ["отсюда следует, что"]],
    [/\bэто свидетельствует о том, что\b/giu, ["это показывает, что"]],
    [/\bв целом можно отметить, что\b/giu, ["в целом"]],
    [/\bв рамках данного исследования\b/giu, ["в этом исследовании"]],
    [/\bв рамках данного проекта\b/giu, ["в этом проекте"]],
    [/\bв рамках данной работы\b/giu, ["в этой работе"]],
    [/\bв рамках исследования\b/giu, ["в исследовании"]],
    [/\bв рамках проекта\b/giu, ["в проекте"]],
    [/\bв рамках работы\b/giu, ["в работе"]],
    [/\bв процессе проведения анализа\b/giu, ["при анализе"]],
    [/\bв ходе проведённого исследования\b/giu, ["в исследовании"]],
    [/\bоказывает существенное влияние на\b/giu, ["существенно влияет на"]],
    [/\bоказывает значительное влияние на\b/giu, ["заметно влияет на"]],
    [/\bоказывает влияние на\b/giu, ["влияет на"]],
    [/\bпредоставляет возможность\b/giu, ["позволяет"]],
    [/\bдаёт возможность\b/giu, ["позволяет"]],
    [/\bпозволяет обеспечить\b/giu, ["обеспечивает"]],
    [/\bпредставляется целесообразным\b/giu, ["целесообразно"]],
    [/\bв конечном итоге\b/giu, ["в итоге"]],
    [/\bнаиболее оптимальн/giu, ["оптимальн"]],
    [/\bданное исследование\b/giu, ["это исследование"]],
    [/\bданная работа\b/giu, ["эта работа"]],
    [/\bданный проект\b/giu, ["этот проект"]],
    [/\bданный подход\b/giu, ["этот подход"]],
    [/\bданный метод\b/giu, ["этот метод"]],
    [/\bданная проблема\b/giu, ["эта проблема"]],
    [/\bданный вопрос\b/giu, ["этот вопрос"]],
    [/\bв современном мире\b/giu, ["сейчас"]],
    [/\bнеотъемлемой частью\b/giu, ["составной частью"]],
    [/\bважно отметить, что\b/giu, ["отметим, что"]],
    [/\bследует отметить, что\b/giu, ["отметим, что"]],
    [/\bнеобходимо отметить, что\b/giu, ["отметим, что"]],
    [/\bстоит подчеркнуть, что\b/giu, ["подчеркнём, что"]],
    [/\bнельзя не отметить, что\b/giu, ["отметим, что"]],
    [/\bв связи с тем, что\b/giu, ["поскольку"]],
    [/\bв силу того, что\b/giu, ["поскольку"]],
    [/\bнесмотря на то, что\b/giu, ["хотя"]],
    [/\bв случае, если\b/giu, ["если"]],
    [/\bс целью\b/giu, ["для"]],
    [/\bв настоящее время\b/giu, ["сейчас"]],
    [/\bна сегодняшний день\b/giu, ["сейчас"]],
    [/\bбольшое количество\b/giu, ["множество"]],
    [/\bпринимая во внимание\b/giu, ["учитывая"]],
    [/\bосуществляется\b/giu, ["выполняется"]],
    [/\bявляется важным\b/giu, ["важен"]],
    [/\bиграет ключевую роль\b/giu, ["имеет ключевое значение"]],
    [/\bширокий спектр\b/giu, ["ряд"]],
    [/\bв заключение можно сказать, что\b/giu, ["в итоге"]],
    [/\bв связи с этим,/giu, ["Поэтому,", "По этой причине,"], { variation: true }],
    [/\bследует сказать, что\b/giu, ["отметим, что"]],
    [/\bподводя итог\b/giu, ["в итоге"]],
    [/\bв заключение,/giu, ["в итоге,"]],
    [/\bможно сделать вывод, что\b/giu, ["отсюда следует, что"]],
    [/\bне подлежит сомнению\b/giu, ["не вызывает сомнений"]],
    // Варианты обязаны быть вводными: замена целиком включает запятую, а
    // «также» вводным не является и запятой после себя не требует.
    [/\bкроме того,/giu, ["помимо этого,", "наряду с этим,"], { variation: true }],
    [/\bболее того,/giu, ["к тому же,", "кроме того,"], { variation: true }],
    // Канцелярит: обороты, где смысл несёт одно слово, а остальные его
    // обслуживают. Правило отбора прежнее — заменяем только там, где
    // зависимые слова остаются в том же падеже. «Проведение анализа» →
    // «анализ» сюда не попало: следом идёт сказуемое, которое согласовано
    // с прежним подлежащим по роду.
    [/\bобеспечивает возможность (?=[\p{L}]+ть(?![\p{L}]))/giu, ["позволяет "]],
    [/\bобеспечивают возможность (?=[\p{L}]+ть(?![\p{L}]))/giu, ["позволяют "]],
    [/\bпредоставляет возможность (?=[\p{L}]+ть(?![\p{L}]))/giu, ["позволяет "]],
    [/\bимеется возможность (?=[\p{L}]+ть(?![\p{L}]))/giu, ["можно "]],
    [/\bосуществление контроля\b/giu, ["контроль"]],
    [/\bосуществления контроля\b/giu, ["контроля"]],
    [/\bоказывающих воздействие на\b/giu, ["влияющих на"]],
    [/\bоказывающие воздействие на\b/giu, ["влияющие на"]],
    [/\bоказывающих влияние на\b/giu, ["влияющих на"]],
    [/\bна основании полученных данных\b/giu, ["по этим данным"]],
    [/\bна основании данных\b/giu, ["по данным"]],
    [/\bможно сделать вывод, что\b/giu, ["значит,"]],
    [/\bможно сделать вывод о том, что\b/giu, ["значит,"]],
    [/\bналичие ряда факторов\b/giu, ["несколько факторов"]],
    [/\bряд факторов\b/giu, ["несколько факторов"]],
    [/\bпри наличии\b/giu, ["если есть"]],
    [/\bв случае отсутствия\b/giu, ["без"]],
    [/\bдля того чтобы\b/giu, ["чтобы"]],
    [/\bдля того, чтобы\b/giu, ["чтобы"]],
    [/\bпо причине\b/giu, ["из-за"]],
    [/\bявляется одним из\b/giu, ["один из"]],
    [/\bявляются одними из\b/giu, ["одни из"]],
    [/\bзначительное количество\b/giu, ["много"]],
    [/\bдостаточно большое количество\b/giu, ["много"]],
    [/\bбыл проведён анализ\b/giu, ["анализ провели"]],
    [/\bбыл проведен анализ\b/giu, ["анализ провели"]],
    [/\bбыло проведено исследование\b/giu, ["исследование провели"]],
    [/\bбыли получены результаты\b/giu, ["результаты получили"]],
    [/\bв рамках проведения\b/giu, ["при"]],
    [/\bс целью обеспечения\b/giu, ["ради"]],
    [/\bв целях обеспечения\b/giu, ["ради"]],
    [/\bспособствует повышению\b/giu, ["повышает"]],
    [/\bспособствует снижению\b/giu, ["снижает"]],
    [/\bприводит к необходимости\b/giu, ["требует"]],
    [/\bсуществует необходимость\b/giu, ["нужно"]],
    [/\bв первую очередь,/giu, ["прежде всего,"], { variation: true }],

    [/\bтаким образом,/giu, ["следовательно,", "в результате,"], { variation: true }],
  ];

  function compile(rules) {
    return rules.map(([pattern, replacements, options], index) => {
      const unicodeSource = pattern.source
        .replace(/^\\b/, "(?<![\\p{L}\\p{N}_-])")
        .replace(/\\b$/, "(?![\\p{L}\\p{N}_-])");
      return {
        pattern: new RegExp(unicodeSource, pattern.flags),
        replacements,
        index,
        variation: Boolean(options && options.variation),
      };
    });
  }

  const RULE_SETS = { en: compile(ACADEMIC_EN), ru: compile(ACADEMIC_RU) };

  /** Язык определяется по преобладанию кириллицы; по умолчанию английский. */
  function detectLanguage(text) {
    const cyrillic = (String(text).match(/\p{Script=Cyrillic}/gu) || []).length;
    const latin = (String(text).match(/\p{Script=Latin}/gu) || []).length;
    return cyrillic > latin ? "ru" : "en";
  }

  function countWords(text) {
    return (text.match(WORD_RE) || []).length;
  }

  function stableHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function matchCase(source, replacement) {
    if (!source || !replacement) return replacement;
    const firstLetter = source.match(/\p{L}/u);
    if (!firstLetter || firstLetter[0] !== firstLetter[0].toLocaleUpperCase("ru")) return replacement;
    return replacement.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("ru"));
  }

  function protectSegments(text) {
    const values = [];
    return {
      text: text.replace(PROTECTED_RE, (value) => {
        const token = `\uE100${values.length}\uE101`;
        values.push(value);
        return token;
      }),
      restore(value) {
        return value.replace(/\uE100(\d+)\uE101/g, (_match, index) => values[Number(index)] || "");
      },
    };
  }

  function collectAnchors(text, pattern) {
    return (text.match(pattern) || []).map((item) => item.toLocaleLowerCase("ru")).sort();
  }

  function sameArray(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function paragraphCandidates(text, seed, rules) {
    const candidates = [];
    for (const rule of rules) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      for (const match of text.matchAll(pattern)) {
        const variant = rule.replacements[(seed + rule.index + match.index) % rule.replacements.length];
        candidates.push({
          start: match.index,
          end: match.index + match[0].length,
          source: match[0],
          replacement: matchCase(match[0], variant),
          variation: rule.variation,
        });
      }
    }
    return candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  }

  function paraphraseParagraph(paragraph, rules, offset) {
    if (countWords(paragraph) <= 12 && !/[.!?…]["»”')\]]*\s*$/.test(paragraph)) {
      return { text: paragraph, replacements: 0 };
    }
    const protectedText = protectSegments(paragraph);
    const candidates = paragraphCandidates(protectedText.text, stableHash(paragraph) + (offset || 0), rules);
    // Правки регистра (сокращённые формы, канцелярит, обороты-маркеры)
    // применяются везде: это исправления, а не стилистический выбор.
    // Лимит на абзац остаётся только для вариативных связок, чтобы
    // соседние абзацы не начинались одинаково.
    const variationLimit = Math.min(3, Math.max(1, Math.ceil(countWords(paragraph) / 45)));
    const selected = [];
    let occupiedUntil = -1;
    let variationsUsed = 0;
    for (const candidate of candidates) {
      if (candidate.start < occupiedUntil) continue;
      if (candidate.variation) {
        if (variationsUsed >= variationLimit) continue;
        variationsUsed += 1;
      }
      selected.push(candidate);
      occupiedUntil = candidate.end;
    }

    let result = protectedText.text;
    for (const candidate of selected.slice().reverse()) {
      result = result.slice(0, candidate.start) + candidate.replacement + result.slice(candidate.end);
    }
    return { text: protectedText.restore(result), replacements: selected.length };
  }

  /**
   * Все места, где словарь может что-то заменить, со всеми вариантами замены.
   *
   * paraphraseText выбирает вариант по хешу и отдаёт одну готовую версию.
   * Пословному перебору нужно обратное: знать, какие именно места допускают
   * выбор и какой именно, — чтобы менять по одному месту за шаг и смотреть,
   * что это даёт. Защищённые участки (ссылки, цитаты, кавычки) исключаются
   * тем же способом, что и при обычной замене.
   */
  function replacementOptions(input, language) {
    const source = String(input || "");
    const resolved = language || detectLanguage(source);
    const rules = RULE_SETS[resolved] || RULE_SETS.en;
    const protectedText = protectSegments(source);
    const places = [];
    let occupiedUntil = -1;

    for (const rule of rules) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      for (const match of protectedText.text.matchAll(pattern)) {
        if (rule.replacements.length < 2) continue;
        places.push({
          start: match.index,
          end: match.index + match[0].length,
          source: match[0],
          options: rule.replacements.map((variant) => matchCase(match[0], variant)),
        });
      }
    }

    // Пересекающиеся места не годятся: заменив одно, мы сдвинем границы
    // другого, и вторая замена встанет не туда.
    //
    // Наружу отдаются готовые предложения, а не смещения: смещения посчитаны
    // в защищённом тексте, где ссылки и цитаты подменены токенами, и резать
    // по ним исходник нельзя. Вся арифметика остаётся здесь, рядом с защитой.
    return places
      .sort((left, right) => left.start - right.start || right.end - left.end)
      .filter((place) => {
        if (place.start < occupiedUntil) return false;
        occupiedUntil = place.end;
        return true;
      })
      .map((place) => ({
        source: place.source,
        options: place.options,
        variants: place.options.map((option) =>
          protectedText.restore(
            protectedText.text.slice(0, place.start) + option + protectedText.text.slice(place.end),
          ),
        ),
      }));
  }

  function paraphraseText(input, language, offset) {
    const source = String(input || "");
    const resolved = language || detectLanguage(source);
    const rules = RULE_SETS[resolved] || RULE_SETS.en;
    let replacements = 0;
    const text = source.split(/(\n{2,})/).map((part) => {
      if (/^\n{2,}$/.test(part)) return part;
      const result = paraphraseParagraph(part, rules, offset);
      replacements += result.replacements;
      return result.text;
    }).join("");

    const issues = [];
    if (!sameArray(collectAnchors(source, NUMBER_RE), collectAnchors(text, NUMBER_RE))) {
      issues.push("изменились числа");
    }
    if (!sameArray(collectAnchors(source, URL_RE), collectAnchors(text, URL_RE))) {
      issues.push("изменились ссылки");
    }
    if (source.split(/\n{2,}/).length !== text.split(/\n{2,}/).length) {
      issues.push("изменилась структура абзацев");
    }

    return issues.length
      ? { text: source, replacements: 0, language: resolved, warnings: [`Перефразирование отменено: ${issues.join(", ")}.`] }
      : { text, replacements, language: resolved, warnings: [] };
  }

  /**
   * Несколько версий одного текста: то же самое правило, но другой вариант
   * замены. Нужны для отбора формулировки — по перплексии или по любой
   * другой оценке. Возвращаются только версии, которые действительно
   * отличаются друг от друга, и всегда хотя бы одна.
   */
  function paraphraseVariants(input, language, limit) {
    const wanted = Math.max(1, Math.min(limit || 3, 6));
    const seen = new Set();
    const results = [];
    for (let offset = 0; offset < wanted * 3 && results.length < wanted; offset += 1) {
      const outcome = paraphraseText(input, language, offset);
      if (seen.has(outcome.text)) continue;
      seen.add(outcome.text);
      results.push(outcome);
    }
    return results;
  }

  return { paraphraseText, paraphraseVariants, replacementOptions, detectLanguage, countWords };
});

// 100 public study-topic pages: 10 subjects x 10 topics. [name, one-line summary]
const DATA = {
  "Biology": [
    ["Cell Structure", "Cells are the basic unit of life; organelles such as the nucleus, mitochondria and ribosomes each carry out specialised jobs."],
    ["Mitosis and Meiosis", "Mitosis makes two identical body cells for growth and repair, while meiosis makes four genetically distinct gametes."],
    ["DNA Replication", "Before a cell divides, helicase unwinds DNA and polymerase copies each strand, producing two identical double helices."],
    ["Protein Synthesis", "Genes are transcribed into mRNA in the nucleus and translated into proteins by ribosomes using tRNA."],
    ["Photosynthesis", "Plants convert light, water and carbon dioxide into glucose and oxygen in the chloroplasts."],
    ["Cellular Respiration", "Cells break down glucose with oxygen to release ATP, the energy currency used for almost every cellular process."],
    ["Natural Selection", "Individuals with heritable traits suited to their environment survive and reproduce more, shifting populations over generations."],
    ["Genetics and Inheritance", "Alleles are passed from parents to offspring following patterns such as dominance, segregation and independent assortment."],
    ["Ecosystems and Food Webs", "Energy flows from producers to consumers and decomposers while nutrients cycle through living and non-living parts of an ecosystem."],
    ["The Immune System", "Innate and adaptive defences recognise pathogens, with antibodies and memory cells giving lasting protection."]
  ],
  "Chemistry": [
    ["Atomic Structure", "Atoms consist of protons, neutrons and electrons; electron arrangement determines how an element behaves."],
    ["The Periodic Table", "Elements are arranged by atomic number so that groups and periods reveal trends in reactivity, size and electronegativity."],
    ["Chemical Bonding", "Ionic, covalent and metallic bonds arise from the transfer or sharing of electrons and set a substance's properties."],
    ["Stoichiometry", "Balanced equations and the mole concept let you calculate quantities of reactants and products in a reaction."],
    ["Acids and Bases", "Acids donate protons and bases accept them; the pH scale measures hydrogen ion concentration."],
    ["Chemical Kinetics", "Reaction rates depend on concentration, temperature, surface area and catalysts, described by rate laws and activation energy."],
    ["Thermochemistry", "Enthalpy changes tell you whether a reaction releases or absorbs heat, and Hess's law links them together."],
    ["Organic Chemistry Basics", "Carbon-based compounds are classified by functional groups such as alkanes, alcohols and carboxylic acids."],
    ["Electrochemistry", "Redox reactions move electrons, powering cells and batteries and driving electrolysis."],
    ["Chemical Equilibrium", "Reversible reactions reach a state where forward and reverse rates match, shifted by Le Chatelier's principle."]
  ],
  "Physics": [
    ["Newton's Laws of Motion", "Inertia, F = ma and action-reaction pairs explain how forces change the motion of objects."],
    ["Work, Energy and Power", "Work transfers energy; kinetic and potential energy are conserved in closed systems, and power is the rate of doing work."],
    ["Waves and Sound", "Waves transfer energy through oscillation, described by wavelength, frequency, amplitude, interference and the Doppler effect."],
    ["Optics", "Reflection, refraction, lenses and mirrors explain image formation, and wave optics explains diffraction and interference."],
    ["Electric Circuits", "Voltage, current and resistance are related by Ohm's law, and Kirchhoff's rules analyse series and parallel networks."],
    ["Magnetism and Electromagnetism", "Moving charges create magnetic fields, and changing fields induce currents, the basis of motors and generators."],
    ["Thermodynamics", "Heat, temperature, entropy and the laws of thermodynamics govern energy transfer and the direction of natural processes."],
    ["Gravitation", "Every mass attracts every other; Newton's law of gravitation explains orbits, weight and tides."],
    ["Modern Physics", "Relativity and quantum mechanics describe nature at very high speeds and very small scales."],
    ["Fluid Mechanics", "Pressure, buoyancy and flow in liquids and gases are described by Pascal's principle, Archimedes' principle and Bernoulli's equation."]
  ],
  "Mathematics": [
    ["Algebra Fundamentals", "Variables, equations, factorising and inequalities form the toolkit for solving unknowns."],
    ["Calculus: Limits and Derivatives", "Limits define instantaneous rates of change, and derivatives measure slopes and optimise functions."],
    ["Integration", "Integrals compute areas, accumulations and totals, and the fundamental theorem links them to derivatives."],
    ["Linear Algebra", "Vectors, matrices and linear transformations solve systems of equations and underpin data science and graphics."],
    ["Probability", "Probability quantifies uncertainty using events, conditional probability, independence and distributions."],
    ["Trigonometry", "Sine, cosine and tangent relate angles to side lengths and model periodic behaviour."],
    ["Geometry", "Properties of shapes, angles, area, volume and proofs describe space in two and three dimensions."],
    ["Number Theory", "Primes, divisibility, modular arithmetic and gcd reveal the structure of the integers."],
    ["Sequences and Series", "Arithmetic and geometric sequences and their sums, with convergence tests for infinite series."],
    ["Differential Equations", "Equations relating a function to its derivatives model growth, decay, motion and circuits."]
  ],
  "Computer Science": [
    ["Algorithms and Complexity", "Algorithms are step-by-step procedures, and Big-O notation compares how their cost grows with input size."],
    ["Data Structures", "Arrays, linked lists, stacks, queues, trees, hash tables and graphs organise data for efficient access."],
    ["Databases and SQL", "Relational databases store structured data in tables, queried with SQL and kept consistent with transactions."],
    ["Operating Systems", "Operating systems manage processes, memory, files and devices, and schedule how programs share the CPU."],
    ["Computer Networks", "Layered protocols such as TCP/IP, DNS and HTTP let computers communicate across the internet."],
    ["Machine Learning Basics", "Models learn patterns from data through training, validation and testing to make predictions."],
    ["Object-Oriented Programming", "Classes, objects, inheritance, encapsulation and polymorphism structure code around reusable components."],
    ["Cybersecurity Fundamentals", "Confidentiality, integrity and availability are protected with encryption, authentication and safe design."],
    ["Version Control with Git", "Git tracks changes with commits, branches and merges so teams can collaborate safely on code."],
    ["Web Development Basics", "HTML structures pages, CSS styles them, and JavaScript adds behaviour, backed by servers and APIs."]
  ],
  "Earth Science": [
    ["Plate Tectonics", "Earth's lithosphere is split into moving plates whose interactions build mountains and cause earthquakes and volcanoes."],
    ["The Water Cycle", "Water evaporates, condenses, precipitates and flows back through rivers, groundwater and oceans."],
    ["Weather and Climate", "Weather is short-term atmospheric conditions; climate is the long-term average shaped by latitude, oceans and circulation."],
    ["Rocks and Minerals", "Igneous, sedimentary and metamorphic rocks form and transform through the rock cycle."],
    ["Oceans", "Ocean currents, tides and chemistry regulate climate and support marine ecosystems."],
    ["Climate Change", "Rising greenhouse gas concentrations trap heat, changing temperatures, sea level and weather patterns."],
    ["Earthquakes and Volcanoes", "Sudden release of stress along faults and the rise of magma explain seismic and volcanic hazards."],
    ["Soil Science", "Soil forms from weathered rock and organic matter, and its layers, texture and nutrients control plant growth."],
    ["Astronomy Basics", "Stars, planets, galaxies and the evolution of the universe are studied through light and gravity."],
    ["Renewable Energy", "Solar, wind, hydro and geothermal sources generate power with far lower emissions than fossil fuels."]
  ],
  "Health and Medicine": [
    ["Human Anatomy Basics", "The body is organised from cells to tissues, organs and organ systems that work together."],
    ["The Cardiovascular System", "The heart and blood vessels circulate blood to deliver oxygen and nutrients and remove waste."],
    ["The Nervous System", "The brain, spinal cord and nerves send electrical signals that control movement, sensation and thought."],
    ["Nutrition", "Carbohydrates, proteins, fats, vitamins and minerals supply energy and materials the body needs."],
    ["Pharmacology Basics", "Drugs act on targets in the body, and their absorption, distribution, metabolism and excretion determine dosing."],
    ["Microbiology", "Bacteria, viruses, fungi and parasites can cause disease, and studying them guides treatment and prevention."],
    ["Public Health and Epidemiology", "Epidemiology tracks how diseases spread and which interventions protect populations."],
    ["Endocrine System", "Hormones from glands such as the thyroid and pancreas regulate metabolism, growth and blood sugar."],
    ["First Aid Essentials", "Basic steps for bleeding, burns, choking and CPR can keep someone safe until professional help arrives."],
    ["Medical Ethics", "Autonomy, beneficence, non-maleficence and justice guide decisions in patient care and research."]
  ],
  "Economics": [
    ["Supply and Demand", "Prices adjust until the quantity buyers want equals the quantity sellers offer."],
    ["Microeconomics", "How households and firms make choices about consumption, production and pricing under scarcity."],
    ["Macroeconomics", "National output, employment, inflation and growth are studied for the whole economy."],
    ["Inflation and Monetary Policy", "Central banks use interest rates and money supply to keep prices stable and support growth."],
    ["International Trade", "Comparative advantage explains why countries gain by specialising and trading, and tariffs and exchange rates shape it."],
    ["Game Theory", "Strategic interactions such as the prisoner's dilemma are analysed through payoffs and equilibria."],
    ["Fiscal Policy and Taxation", "Government spending and taxes influence demand, income distribution and public services."],
    ["Market Structures", "Perfect competition, monopoly, oligopoly and monopolistic competition differ in pricing power and efficiency."],
    ["Economic Growth and Development", "Capital, labour, technology and institutions drive rising living standards over time."],
    ["Behavioural Economics", "Biases and heuristics show where real decisions depart from perfectly rational choice."]
  ],
  "Psychology": [
    ["Cognitive Psychology", "Attention, perception, language and problem solving describe how the mind processes information."],
    ["Developmental Psychology", "How thinking, emotion and social behaviour change from infancy through old age."],
    ["Learning and Conditioning", "Classical and operant conditioning explain how associations and consequences shape behaviour."],
    ["Memory", "Encoding, storage and retrieval, and the difference between short-term, long-term and working memory."],
    ["Personality Theories", "Trait, psychodynamic, humanistic and social-cognitive approaches explain individual differences."],
    ["Social Psychology", "Conformity, obedience, attitudes and group behaviour show how others influence us."],
    ["Abnormal Psychology", "Classification, causes and treatments of psychological disorders, from anxiety to schizophrenia."],
    ["Neuroscience of Behaviour", "Neurons, neurotransmitters and brain regions underlie thought, emotion and action."],
    ["Motivation and Emotion", "Needs, drives and goals explain why we act, and emotions shape how we respond."],
    ["Research Methods in Psychology", "Experiments, correlations and surveys test hypotheses, with ethics and validity as central concerns."]
  ],
  "Research Methods": [
    ["Designing an Experiment", "Define variables, controls and groups, and randomise so that results can support causal conclusions."],
    ["Hypothesis Testing", "Null and alternative hypotheses, p-values and significance levels decide whether data support a claim."],
    ["Descriptive Statistics", "Mean, median, spread and distributions summarise a data set before deeper analysis."],
    ["Regression Analysis", "Regression models the relationship between variables to explain or predict outcomes."],
    ["Sampling Methods", "Random, stratified and cluster sampling aim to make a sample represent the wider population."],
    ["Literature Review", "Search, screen and synthesise existing studies to find gaps and frame your research question."],
    ["Scientific Writing", "Clear structure (introduction, methods, results, discussion) and precise language communicate findings."],
    ["Data Visualisation", "Choosing the right chart and encoding makes patterns honest and easy to see."],
    ["Research Ethics", "Informed consent, confidentiality, honest reporting and avoiding plagiarism protect participants and integrity."],
    ["Reproducible Research", "Sharing data, code and methods lets others verify and build on your results."]
  ]
};

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const TOPICS = [];
for (const [subject, list] of Object.entries(DATA)) {
  for (const [name, summary] of list) {
    TOPICS.push({ slug: slugify(name), subject, name, summary });
  }
}
// slugs must be unique
if (new Set(TOPICS.map((t) => t.slug)).size !== TOPICS.length) throw new Error("Duplicate topic slug");

module.exports = { TOPICS, SUBJECTS: Object.keys(DATA) };

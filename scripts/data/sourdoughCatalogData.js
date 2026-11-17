const SOURCE_BY_CATEGORY = {
  "Artisan loaves": "https://www.theperfectloaf.com/best-sourdough-recipe/",
  "Grain and flavour breads": "https://www.theperfectloaf.com/recipes/",
  "Shaped specialty breads": "https://www.theperfectloaf.com/sourdough-baguettes/",
  "Sandwich and pan breads": "https://www.theperfectloaf.com/sourdough-sandwich-bread-with-pre-cooked-flour/",
  "Rolls and buns": "https://www.theperfectloaf.com/super-soft-sourdough-rolls/",
  "Bagels and boiled breads": "https://www.kingarthurbaking.com/recipes/sourdough-bagels-recipe",
  "Pizza and savoury doughs": "https://www.kingarthurbaking.com/recipes/sourdough-pizza-crust-recipe",
  Flatbreads: "https://www.theperfectloaf.com/whole-wheat-sourdough-pita/",
  "Pretzels and savoury bakes": "https://www.kingarthurbaking.com/recipes/collections/sourdough-beyond-crusty-bread",
  "Breakfast griddle breads": "https://www.kingarthurbaking.com/recipes/collections/sourdough-discard-recipes",
  "Crackers and crisp products": "https://www.kingarthurbaking.com/recipes/collections/sourdough-discard-recipes",
  "Enriched and sweet breads": "https://www.theperfectloaf.com/sourdough-challah/",
  "Fried doughs": "https://www.theperfectloaf.com/naturally-leavened-bomboloni-doughnuts/",
  "Cakes and quick breads": "https://www.kingarthurbaking.com/recipes/collections/sourdough-discard-recipes",
  "Cookies and bars": "https://www.kingarthurbaking.com/recipes/collections/sourdough-discard-recipes",
  "Pies and pastries": "https://www.kingarthurbaking.com/recipes/sourdough-pie-crust-recipe",
  "Products from leftover sourdough bread": "https://www.theperfectloaf.com/leftover-sourdough-bread-croutons-breadcrumbs/",
};

const PRODUCTS = [
  {
    category: "Artisan loaves",
    saleUnit: "loaf",
    products: [
      { slug: "country-loaf", name: "Country Sourdough Loaf", flavour: "Classic", price: 14000, yield: 8, description: "A naturally leavened country loaf with a crisp crust, open crumb and balanced tang, made for everyday slicing and sharing.", ingredients: [["Bread flour", 4.5], ["Water", 3.15], ["Active sourdough starter", 0.9], ["Fine salt", 0.09]] },
      { slug: "whole-wheat-boule", name: "Whole-Wheat Sourdough Boule", flavour: "Whole wheat", price: 16000, yield: 8, description: "A hearty round loaf blending whole-wheat and bread flours for a nutty aroma, tender crumb and satisfying grain character.", ingredients: [["Bread flour", 2.7], ["Whole-wheat flour", 2.25], ["Water", 3.35], ["Active sourdough starter", 0.9], ["Fine salt", 0.09]] },
      { slug: "rye-caraway-miche", name: "Rye and Caraway Miche", flavour: "Caraway", price: 18000, yield: 7, description: "A substantial rye-forward sourdough with warm caraway notes and a moist, full-flavoured crumb that pairs well with savoury meals.", ingredients: [["Bread flour", 2.4], ["Rye flour", 2.1], ["Water", 3.4], ["Active sourdough starter", 0.9], ["Fine salt", 0.09], ["Caraway seeds", 0.045]] },
    ],
    flavours: [
      { name: "Olive and rosemary", slug: "olive-rosemary", additions: [["Kalamata olives", 0.5], ["Fresh rosemary", 0.025]], priceAdd: 3000, description: "Briny olives and fragrant rosemary bring a savoury Mediterranean note to the slow-fermented country crumb." },
      { name: "Walnut and cranberry", slug: "walnut-cranberry", additions: [["Walnuts", 0.35], ["Dried cranberries", 0.3]], priceAdd: 4000, description: "Toasted walnuts and tart cranberries add a pleasing contrast of crunch and fruit to the classic country loaf." },
    ],
  },
  {
    category: "Grain and flavour breads",
    saleUnit: "loaf",
    products: [
      { slug: "multigrain-loaf", name: "Multigrain Sourdough Loaf", flavour: "Multigrain", price: 17000, yield: 8, description: "A wholesome sourdough loaf with a wheat-and-rye base and a varied grain profile for a robust, textured slice.", ingredients: [["Bread flour", 3.0], ["Whole-wheat flour", 1.4], ["Rye flour", 0.6], ["Water", 3.4], ["Active sourdough starter", 0.9], ["Fine salt", 0.09], ["Mixed seeds", 0.3]] },
      { slug: "spelt-oat-loaf", name: "Spelt and Oat Sourdough", flavour: "Spelt and oat", price: 18000, yield: 8, description: "An aromatic loaf combining spelt and oats with a mild sourdough tang and soft, close-textured crumb.", ingredients: [["Bread flour", 2.7], ["Spelt flour", 1.8], ["Rolled oats", 0.45], ["Water", 3.35], ["Active sourdough starter", 0.9], ["Fine salt", 0.09], ["Honey", 0.18]] },
      { slug: "cinnamon-raisin-loaf", name: "Cinnamon-Raisin Sourdough", flavour: "Cinnamon raisin", price: 18000, yield: 8, description: "A gently sweet sourdough loaf with plump raisins and warming cinnamon, ideal for breakfast or toasted slices.", ingredients: [["Bread flour", 4.0], ["Water", 2.9], ["Active sourdough starter", 0.85], ["Fine salt", 0.08], ["Raisins", 0.65], ["Brown sugar", 0.2], ["Ground cinnamon", 0.025]] },
    ],
    flavours: [
      { name: "Seeded multigrain", slug: "seeded-multigrain", additions: [["Mixed seeds", 0.3]], priceAdd: 2000, description: "An extra-seeded version with a nutty crunch and a satisfying, fibre-rich finish." },
      { name: "Apricot and sunflower", slug: "apricot-sunflower", additions: [["Dried apricots", 0.35], ["Sunflower seeds", 0.2]], priceAdd: 3500, description: "Sweet dried apricot and toasted sunflower seeds add bright fruit and crunch to a hearty grain loaf." },
    ],
  },
  {
    category: "Shaped specialty breads",
    saleUnit: "piece",
    products: [
      { slug: "sourdough-baguette", name: "Sourdough Baguette", flavour: "Classic", price: 7000, yield: 12, description: "A slender, naturally leavened baguette with a crisp, deeply coloured crust and a light, chewy interior.", ingredients: [["Bread flour", 5.0], ["Water", 3.45], ["Active sourdough starter", 0.85], ["Fine salt", 0.1]] },
      { slug: "sourdough-ciabatta", name: "Sourdough Ciabatta", flavour: "Classic", price: 8000, yield: 10, description: "A rustic high-hydration ciabatta with a delicate crust and irregular airy crumb, suited to sandwiches or table service.", ingredients: [["Bread flour", 5.0], ["Water", 4.0], ["Active sourdough starter", 0.9], ["Fine salt", 0.1], ["Olive oil", 0.12]] },
      { slug: "sourdough-fougasse", name: "Olive and Herb Fougasse", flavour: "Olive and herb", price: 10000, yield: 10, description: "A leaf-shaped Provençal-style bread with olive oil, herbs and a crisp, golden surface for sharing.", ingredients: [["Bread flour", 4.5], ["Water", 3.0], ["Active sourdough starter", 0.85], ["Fine salt", 0.09], ["Olive oil", 0.2], ["Kalamata olives", 0.45], ["Herb blend", 0.04]] },
    ],
    flavours: [
      { name: "Rosemary baguette", slug: "rosemary", additions: [["Fresh rosemary", 0.035]], priceAdd: 1000, description: "A fragrant baguette accented with fresh rosemary and a crisp, golden crust." },
      { name: "Sesame baguette", slug: "sesame", additions: [["Sesame seeds", 0.18]], priceAdd: 1000, description: "A classic sourdough baguette finished with toasted sesame for extra aroma and crunch." },
    ],
  },
  {
    category: "Sandwich and pan breads",
    saleUnit: "loaf",
    products: [
      { slug: "sandwich-loaf", name: "Sourdough Sandwich Loaf", flavour: "Classic", price: 13000, yield: 8, description: "A soft, sliceable sourdough loaf with a fine crumb and gentle tang, designed for dependable sandwiches and toast.", ingredients: [["Bread flour", 4.6], ["Water", 2.6], ["Active sourdough starter", 0.8], ["Whole milk", 0.5], ["Unsalted butter", 0.3], ["Fine salt", 0.09], ["Sugar", 0.18]] },
      { slug: "pullman-loaf", name: "Sourdough Pullman Loaf", flavour: "Milk bread", price: 15000, yield: 8, description: "A square-crumbed pan loaf enriched with milk and butter for even slices, a tender bite and a delicate crust.", ingredients: [["Bread flour", 4.8], ["Whole milk", 2.3], ["Active sourdough starter", 0.8], ["Unsalted butter", 0.4], ["Sugar", 0.22], ["Fine salt", 0.09], ["Eggs", 0.3]] },
      { slug: "sourdough-shokupan", name: "Sourdough Shokupan", flavour: "Milk bread", price: 17000, yield: 8, description: "A soft Japanese-inspired milk loaf with a feather-light crumb and subtle cultured flavour, excellent for toast and sandwiches.", ingredients: [["Bread flour", 4.4], ["Whole milk", 2.4], ["Water", 0.8], ["Active sourdough starter", 0.8], ["Unsalted butter", 0.45], ["Sugar", 0.25], ["Fine salt", 0.09], ["Eggs", 0.25]] },
    ],
    flavours: [
      { name: "Seeded sandwich loaf", slug: "seeded", additions: [["Mixed seeds", 0.22]], priceAdd: 2000, description: "A soft sandwich loaf with a toasted seed mix for extra texture and a savoury, nutty finish." },
      { name: "Cinnamon-raisin sandwich loaf", slug: "cinnamon-raisin", additions: [["Raisins", 0.5], ["Brown sugar", 0.15], ["Ground cinnamon", 0.02]], priceAdd: 2500, description: "A tender pan loaf with sweet raisins and cinnamon, made for breakfast toast and lunchbox slices." },
    ],
  },
  {
    category: "Rolls and buns",
    saleUnit: "pack of 6",
    products: [
      { slug: "dinner-rolls", name: "Sourdough Dinner Rolls", flavour: "Classic", price: 12000, yield: 12, description: "Soft, lightly enriched sourdough rolls with a thin golden crust, ready for the table or a filled lunch.", ingredients: [["Bread flour", 3.2], ["Water", 1.3], ["Whole milk", 0.8], ["Active sourdough starter", 0.65], ["Unsalted butter", 0.3], ["Sugar", 0.18], ["Fine salt", 0.07], ["Eggs", 0.2]] },
      { slug: "burger-buns", name: "Sourdough Burger Buns", flavour: "Classic", price: 15000, yield: 12, description: "A sturdy but tender bun with a soft crumb and lightly enriched dough, sized for burgers and filled sandwiches.", ingredients: [["Bread flour", 3.5], ["Water", 1.1], ["Whole milk", 0.8], ["Active sourdough starter", 0.7], ["Unsalted butter", 0.32], ["Sugar", 0.2], ["Fine salt", 0.07], ["Eggs", 0.3], ["Sesame seeds", 0.12]] },
      { slug: "hot-dog-rolls", name: "Sourdough Hot-Dog Rolls", flavour: "Classic", price: 14000, yield: 12, description: "An elongated, pillowy sourdough roll with a fine crumb that holds fillings without overpowering them.", ingredients: [["Bread flour", 3.6], ["Water", 1.2], ["Whole milk", 0.7], ["Active sourdough starter", 0.7], ["Unsalted butter", 0.28], ["Sugar", 0.18], ["Fine salt", 0.07], ["Eggs", 0.25]] },
    ],
    flavours: [
      { name: "Garlic-herb dinner rolls", slug: "garlic-herb", additions: [["Garlic", 0.06], ["Herb blend", 0.035]], priceAdd: 1500, description: "Buttery soft rolls scented with garlic and herbs for a savoury accompaniment to soups and shared meals." },
      { name: "Sesame dinner rolls", slug: "sesame", additions: [["Sesame seeds", 0.16]], priceAdd: 1000, description: "Tender rolls finished with a toasted sesame crust and a delicate sourdough aroma." },
    ],
  },
  {
    category: "Bagels and boiled breads",
    saleUnit: "pack of 4",
    products: [
      { slug: "plain-bagels", name: "Sourdough Bagels", flavour: "Plain", price: 10000, yield: 16, description: "Chewy, boiled-then-baked sourdough bagels with a glossy crust and a balanced, naturally fermented flavour.", ingredients: [["Bread flour", 4.5], ["Water", 2.0], ["Active sourdough starter", 0.75], ["Fine salt", 0.09], ["Honey", 0.15]] },
      { slug: "seeded-bagels", name: "Seeded Sourdough Bagels", flavour: "Seeded", price: 12000, yield: 16, description: "Traditional sourdough bagels finished with a generous seed topping and a satisfying chewy interior.", ingredients: [["Bread flour", 4.5], ["Water", 2.0], ["Active sourdough starter", 0.75], ["Fine salt", 0.09], ["Honey", 0.15], ["Mixed seeds", 0.22]] },
      { slug: "sourdough-bialy", name: "Sourdough Bialy", flavour: "Onion", price: 12000, yield: 12, description: "A soft, chewy sourdough roll with a shallow centre filled with sweet onion and herbs, made for breakfast or sandwiches.", ingredients: [["Bread flour", 3.8], ["Water", 2.2], ["Active sourdough starter", 0.7], ["Fine salt", 0.08], ["Onions", 0.5], ["Olive oil", 0.08], ["Herb blend", 0.025]] },
    ],
    flavours: [
      { name: "Sesame sourdough bagels", slug: "sesame", additions: [["Sesame seeds", 0.2]], priceAdd: 1500, description: "Chewy sourdough bagels coated in aromatic sesame seeds for a classic savoury finish." },
      { name: "Cinnamon-raisin sourdough bagels", slug: "cinnamon-raisin", additions: [["Raisins", 0.35], ["Brown sugar", 0.15], ["Ground cinnamon", 0.025]], priceAdd: 2000, description: "A gently sweet, chewy bagel with raisins and cinnamon, suited to breakfast or a cream-cheese filling." },
    ],
  },
  {
    category: "Pizza and savoury doughs",
    saleUnit: "base",
    products: [
      { slug: "sourdough-pizza-base", name: "Sourdough Pizza Base", flavour: "Classic", price: 9000, yield: 12, description: "A slow-fermented pizza dough with a crisp, tender bake and subtle tang, ready for the customer's preferred toppings.", ingredients: [["Bread flour", 4.8], ["Water", 3.2], ["Active sourdough starter", 0.8], ["Fine salt", 0.1], ["Olive oil", 0.15]] },
      { slug: "sourdough-focaccia", name: "Sourdough Focaccia", flavour: "Olive oil", price: 16000, yield: 8, description: "A dimpled, olive-oil-rich focaccia with an airy interior and crisp edges, finished with herbs and flaky salt.", ingredients: [["Bread flour", 4.0], ["Water", 3.3], ["Active sourdough starter", 0.8], ["Fine salt", 0.09], ["Olive oil", 0.45], ["Herb blend", 0.035]] },
      { slug: "sourdough-calzone", name: "Sourdough Calzone Dough", flavour: "Classic", price: 11000, yield: 10, description: "A supple sourdough dough portion shaped for baked calzones, with enough strength to hold a savoury filling.", ingredients: [["Bread flour", 4.2], ["Water", 2.7], ["Active sourdough starter", 0.75], ["Fine salt", 0.09], ["Olive oil", 0.18]] },
    ],
    flavours: [
      { name: "Whole-wheat pizza base", slug: "whole-wheat", additions: [["Whole-wheat flour", 0.8]], priceAdd: 1500, description: "A more robust pizza base with whole-wheat flour and the same long-fermented, gently tangy character." },
      { name: "Rosemary-olive pizza base", slug: "rosemary-olive", additions: [["Kalamata olives", 0.25], ["Fresh rosemary", 0.025]], priceAdd: 2500, description: "An aromatic savoury dough with briny olive pieces and fresh rosemary folded through the crust." },
    ],
  },
  {
    category: "Flatbreads",
    saleUnit: "pack of 4",
    products: [
      { slug: "sourdough-pita", name: "Sourdough Pita", flavour: "Classic", price: 10000, yield: 16, description: "Soft, pocket-forming sourdough pita with a light tang and flexible crumb for wraps, dips and filled meals.", ingredients: [["Bread flour", 3.5], ["Water", 2.3], ["Active sourdough starter", 0.7], ["Fine salt", 0.07], ["Olive oil", 0.1]] },
      { slug: "sourdough-tortillas", name: "Sourdough Tortillas", flavour: "Classic", price: 10000, yield: 20, description: "Supple griddle-cooked sourdough tortillas with a mild tang, designed for wraps, quesadillas and quick meals.", ingredients: [["Bread flour", 2.8], ["Water", 1.0], ["Active sourdough starter", 0.55], ["Fine salt", 0.05], ["Olive oil", 0.3]] },
      { slug: "sourdough-naan", name: "Sourdough Naan", flavour: "Yoghurt", price: 12000, yield: 12, description: "A soft, blistered flatbread enriched with yoghurt for a tender bite and gentle tang, finished with a light butter brush.", ingredients: [["Bread flour", 3.2], ["Water", 0.9], ["Plain yoghurt", 0.9], ["Active sourdough starter", 0.65], ["Fine salt", 0.06], ["Unsalted butter", 0.15]] },
    ],
    flavours: [
      { name: "Whole-wheat sourdough pita", slug: "whole-wheat", additions: [["Whole-wheat flour", 0.7]], priceAdd: 1500, description: "A wholesome pita variation blending whole-wheat flour with a soft, pocket-ready sourdough crumb." },
      { name: "Za'atar sourdough pita", slug: "zaatar", additions: [["Za'atar spice blend", 0.08], ["Olive oil", 0.08]], priceAdd: 2000, description: "A savoury pita perfumed with za'atar and olive oil, ready to serve with dips or grilled fillings." },
    ],
  },
  {
    category: "Pretzels and savoury bakes",
    saleUnit: "piece",
    products: [
      { slug: "soft-pretzels", name: "Soft Sourdough Pretzels", flavour: "Sea salt", price: 5000, yield: 16, description: "A chewy, golden pretzel with a glossy alkaline-baked crust and a clean sourdough finish.", ingredients: [["Bread flour", 3.8], ["Water", 1.9], ["Active sourdough starter", 0.7], ["Fine salt", 0.08], ["Brown sugar", 0.08], ["Baking soda", 0.25]] },
      { slug: "sourdough-biscuits", name: "Sourdough Savoury Biscuits", flavour: "Buttermilk", price: 4000, yield: 18, description: "Flaky, tender savoury biscuits with a gentle cultured tang, suitable for breakfast or alongside soups.", ingredients: [["All-purpose flour", 2.6], ["Unsalted butter", 0.9], ["Active sourdough starter", 0.7], ["Buttermilk", 0.55], ["Fine salt", 0.05], ["Baking powder", 0.06]] },
      { slug: "scallion-pancakes", name: "Sourdough Scallion Pancakes", flavour: "Scallion", price: 5000, yield: 12, description: "Crisp-edged savoury griddle cakes with scallion and a light sourdough note, served warm as a snack or side.", ingredients: [["Bread flour", 1.7], ["Water", 1.4], ["Active sourdough starter", 0.5], ["Fine salt", 0.04], ["Scallions", 0.35], ["Sesame oil", 0.12]] },
    ],
    flavours: [
      { name: "Cheddar sourdough pretzels", slug: "cheddar", additions: [["Cheddar cheese", 0.35]], priceAdd: 1500, description: "A savoury pretzel with sharp cheddar folded through the dough for a rich, cheesy finish." },
      { name: "Cinnamon-sugar sourdough pretzels", slug: "cinnamon-sugar", additions: [["Brown sugar", 0.16], ["Ground cinnamon", 0.025]], priceAdd: 1000, description: "A sweet-spiced pretzel finished with cinnamon and sugar, balancing a chewy centre with a delicate crust." },
    ],
  },
  {
    category: "Breakfast griddle breads",
    saleUnit: "pack",
    products: [
      { slug: "sourdough-pancakes", name: "Sourdough Pancakes", flavour: "Classic", price: 10000, yield: 24, description: "Fluffy griddle pancakes with a lightly tangy sourdough profile and a tender centre, ready for breakfast service.", ingredients: [["All-purpose flour", 1.6], ["Active sourdough starter", 1.0], ["Whole milk", 1.2], ["Eggs", 0.5], ["Unsalted butter", 0.25], ["Sugar", 0.14], ["Fine salt", 0.025], ["Baking powder", 0.04]] },
      { slug: "sourdough-waffles", name: "Sourdough Waffles", flavour: "Classic", price: 12000, yield: 20, description: "Golden, crisp-edged waffles with a soft interior and subtle sourdough tang, made for sweet or savoury toppings.", ingredients: [["All-purpose flour", 1.7], ["Active sourdough starter", 0.9], ["Whole milk", 1.3], ["Eggs", 0.55], ["Unsalted butter", 0.35], ["Sugar", 0.15], ["Fine salt", 0.025], ["Baking powder", 0.04]] },
      { slug: "sourdough-crumpets", name: "Sourdough Crumpets", flavour: "Classic", price: 10000, yield: 18, description: "Griddled crumpets with a crisp base, soft interior and characteristic open texture for holding butter and spreads.", ingredients: [["Bread flour", 1.5], ["Water", 1.7], ["Active sourdough starter", 0.75], ["Fine salt", 0.035], ["Sugar", 0.05], ["Baking soda", 0.018]] },
    ],
    flavours: [
      { name: "Blueberry sourdough pancakes", slug: "blueberry", additions: [["Blueberries", 0.4]], priceAdd: 2000, description: "Soft sourdough pancakes dotted with blueberries for a bright fruit flavour and a colourful breakfast plate." },
      { name: "Banana sourdough pancakes", slug: "banana", additions: [["Bananas", 0.45], ["Ground cinnamon", 0.015]], priceAdd: 2000, description: "Tender griddle pancakes with ripe banana and a touch of cinnamon for a naturally sweet breakfast option." },
    ],
  },
  {
    category: "Crackers and crisp products",
    saleUnit: "pack",
    products: [
      { slug: "sourdough-crackers", name: "Sourdough Crackers", flavour: "Sea salt", price: 7000, yield: 24, description: "Thin, crisp crackers with a savoury sourdough finish, baked for an even snap and easy sharing.", ingredients: [["All-purpose flour", 1.6], ["Active sourdough starter", 0.8], ["Olive oil", 0.35], ["Fine salt", 0.035], ["Water", 0.25]] },
      { slug: "sourdough-breadsticks", name: "Sourdough Breadsticks", flavour: "Sesame", price: 7000, yield: 30, description: "Slender, crisp breadsticks with sesame and a mild sourdough aroma, suitable for snack boards and soups.", ingredients: [["Bread flour", 2.0], ["Water", 1.1], ["Active sourdough starter", 0.5], ["Olive oil", 0.18], ["Fine salt", 0.04], ["Sesame seeds", 0.12]] },
      { slug: "sourdough-friselle", name: "Sourdough Friselle", flavour: "Olive oil", price: 8000, yield: 20, description: "Twice-baked, crisp sourdough rounds with a sturdy bite, traditionally softened with a little water before topping.", ingredients: [["Bread flour", 2.6], ["Water", 1.4], ["Active sourdough starter", 0.55], ["Fine salt", 0.05], ["Olive oil", 0.12]] },
    ],
    flavours: [
      { name: "Rosemary sourdough crackers", slug: "rosemary", additions: [["Fresh rosemary", 0.03]], priceAdd: 1000, description: "A crisp, savoury cracker scented with rosemary and finished with a clean sea-salt note." },
      { name: "Sesame sourdough crackers", slug: "sesame", additions: [["Sesame seeds", 0.18]], priceAdd: 1000, description: "A crunchy sourdough cracker with toasted sesame throughout for a nutty aroma and satisfying bite." },
    ],
  },
  {
    category: "Enriched and sweet breads",
    saleUnit: "loaf",
    products: [
      { slug: "sourdough-challah", name: "Sourdough Challah", flavour: "Classic", price: 18000, yield: 6, description: "A braided sourdough challah with a tender, enriched crumb, burnished egg-washed crust and gentle sweetness.", ingredients: [["Bread flour", 3.8], ["Water", 1.2], ["Active sourdough starter", 0.7], ["Eggs", 0.65], ["Olive oil", 0.35], ["Honey", 0.25], ["Fine salt", 0.07]] },
      { slug: "sourdough-cinnamon-rolls", name: "Sourdough Cinnamon Rolls", flavour: "Cinnamon", price: 22000, yield: 12, description: "Soft, naturally leavened rolls layered with cinnamon sugar and finished as a rich bakery-style treat.", ingredients: [["Bread flour", 2.8], ["Whole milk", 0.9], ["Active sourdough starter", 0.6], ["Unsalted butter", 0.55], ["Eggs", 0.35], ["Sugar", 0.35], ["Fine salt", 0.05], ["Ground cinnamon", 0.07]] },
      { slug: "sourdough-babka", name: "Chocolate Sourdough Babka", flavour: "Chocolate", price: 24000, yield: 6, description: "A twisted enriched loaf with a tender sourdough crumb and a generous cocoa-chocolate filling.", ingredients: [["Bread flour", 2.8], ["Whole milk", 0.8], ["Active sourdough starter", 0.6], ["Unsalted butter", 0.55], ["Eggs", 0.35], ["Sugar", 0.35], ["Fine salt", 0.05], ["Cocoa powder", 0.18], ["Dark chocolate", 0.3]] },
    ],
    flavours: [
      { name: "Raisin sourdough challah", slug: "raisin", additions: [["Raisins", 0.4]], priceAdd: 3000, description: "A braided challah enriched with plump raisins for a soft, celebratory loaf with gentle sweetness." },
      { name: "Sesame sourdough challah", slug: "sesame", additions: [["Sesame seeds", 0.14]], priceAdd: 2000, description: "A golden braided loaf finished with toasted sesame for a delicate crunch and savoury aroma." },
    ],
  },
  {
    category: "Fried doughs",
    saleUnit: "piece",
    products: [
      { slug: "sourdough-doughnuts", name: "Sourdough Doughnuts", flavour: "Vanilla glaze", price: 5000, yield: 20, description: "A light, naturally fermented doughnut with a tender centre and a simple vanilla glaze.", ingredients: [["Bread flour", 2.5], ["Whole milk", 0.8], ["Active sourdough starter", 0.6], ["Eggs", 0.35], ["Unsalted butter", 0.35], ["Sugar", 0.3], ["Fine salt", 0.05], ["Vanilla", 0.02], ["Frying oil", 2.0]] },
      { slug: "sourdough-bomboloni", name: "Sourdough Bomboloni", flavour: "Custard-filled", price: 7000, yield: 18, description: "Italian-inspired filled doughnuts with a soft enriched crumb and a smooth vanilla custard centre.", ingredients: [["Bread flour", 2.4], ["Whole milk", 0.9], ["Active sourdough starter", 0.6], ["Eggs", 0.45], ["Unsalted butter", 0.35], ["Sugar", 0.32], ["Fine salt", 0.05], ["Vanilla", 0.02], ["Frying oil", 2.0]] },
      { slug: "sourdough-fritters", name: "Sourdough Apple Fritters", flavour: "Apple and spice", price: 6000, yield: 18, description: "Golden sourdough fritters with apple pieces and warming spice, made for a crisp exterior and tender centre.", ingredients: [["All-purpose flour", 2.0], ["Active sourdough starter", 0.7], ["Whole milk", 0.8], ["Eggs", 0.3], ["Sugar", 0.25], ["Apples", 0.7], ["Ground cinnamon", 0.03], ["Fine salt", 0.04], ["Frying oil", 2.0]] },
    ],
    flavours: [
      { name: "Cinnamon-sugar sourdough doughnuts", slug: "cinnamon-sugar", additions: [["Ground cinnamon", 0.025], ["Brown sugar", 0.12]], priceAdd: 1000, description: "A soft sourdough doughnut rolled in fragrant cinnamon sugar for a warm, nostalgic finish." },
      { name: "Chocolate-glazed sourdough doughnuts", slug: "chocolate-glaze", additions: [["Dark chocolate", 0.25], ["Cocoa powder", 0.08]], priceAdd: 1500, description: "A tender naturally leavened doughnut finished with a smooth dark-chocolate glaze." },
    ],
  },
  {
    category: "Cakes and quick breads",
    saleUnit: "loaf",
    products: [
      { slug: "sourdough-banana-bread", name: "Sourdough Banana Bread", flavour: "Classic", price: 18000, yield: 6, description: "A moist banana loaf with a subtle sourdough tang, ripe fruit sweetness and a soft, even crumb.", ingredients: [["All-purpose flour", 1.5], ["Active sourdough starter", 0.45], ["Bananas", 1.2], ["Eggs", 0.35], ["Unsalted butter", 0.35], ["Brown sugar", 0.35], ["Fine salt", 0.025], ["Baking soda", 0.025]] },
      { slug: "sourdough-chocolate-cake", name: "Sourdough Chocolate Cake", flavour: "Chocolate", price: 24000, yield: 8, description: "A tender cocoa-rich cake with a gentle cultured note and a moist, fine crumb for celebrations or café service.", ingredients: [["All-purpose flour", 1.8], ["Active sourdough starter", 0.6], ["Whole milk", 0.9], ["Cocoa powder", 0.35], ["Sugar", 1.5], ["Eggs", 0.55], ["Sunflower oil", 0.45], ["Baking soda", 0.025], ["Fine salt", 0.025]] },
      { slug: "sourdough-blueberry-muffins", name: "Sourdough Blueberry Muffins", flavour: "Blueberry", price: 5000, yield: 18, description: "Soft bakery-style muffins with juicy blueberries and a mild sourdough finish, baked with a golden domed top.", ingredients: [["All-purpose flour", 1.6], ["Active sourdough starter", 0.55], ["Whole milk", 0.5], ["Blueberries", 0.7], ["Eggs", 0.35], ["Unsalted butter", 0.3], ["Sugar", 0.45], ["Baking powder", 0.045], ["Fine salt", 0.025]] },
    ],
    flavours: [
      { name: "Walnut sourdough banana bread", slug: "walnut", additions: [["Walnuts", 0.28]], priceAdd: 2500, description: "A moist banana sourdough loaf with toasted walnuts for extra crunch and a rich, nutty finish." },
      { name: "Chocolate-chip sourdough banana bread", slug: "chocolate-chip", additions: [["Chocolate chips", 0.3]], priceAdd: 3000, description: "A tender banana loaf studded with chocolate chips for a familiar, indulgent bakery favourite." },
    ],
  },
  {
    category: "Cookies and bars",
    saleUnit: "pack of 4",
    products: [
      { slug: "sourdough-chocolate-chip-cookies", name: "Sourdough Chocolate-Chip Cookies", flavour: "Chocolate chip", price: 10000, yield: 24, description: "Chewy-centred cookies with crisp edges, dark chocolate pieces and a subtle sourdough depth.", ingredients: [["All-purpose flour", 1.4], ["Active sourdough starter", 0.5], ["Unsalted butter", 0.75], ["Brown sugar", 0.65], ["Sugar", 0.3], ["Eggs", 0.25], ["Chocolate chips", 0.65], ["Fine salt", 0.025], ["Baking soda", 0.025]] },
      { slug: "sourdough-sugar-cookies", name: "Sourdough Sugar Cookies", flavour: "Vanilla", price: 9000, yield: 24, description: "Tender, lightly crisp sugar cookies with a delicate vanilla aroma and a gentle cultured finish.", ingredients: [["All-purpose flour", 1.6], ["Active sourdough starter", 0.45], ["Unsalted butter", 0.65], ["Sugar", 0.55], ["Eggs", 0.2], ["Vanilla", 0.025], ["Fine salt", 0.02], ["Baking powder", 0.025]] },
      { slug: "sourdough-brownies", name: "Fudgy Sourdough Brownies", flavour: "Dark chocolate", price: 12000, yield: 20, description: "Dense, fudgy chocolate brownies with a smooth crumb and a quiet sourdough tang that deepens the cocoa flavour.", ingredients: [["All-purpose flour", 0.55], ["Active sourdough starter", 0.45], ["Dark chocolate", 0.8], ["Unsalted butter", 0.55], ["Sugar", 0.85], ["Eggs", 0.45], ["Cocoa powder", 0.12], ["Fine salt", 0.018]] },
    ],
    flavours: [
      { name: "Oatmeal-raisin sourdough cookies", slug: "oatmeal-raisin", additions: [["Rolled oats", 0.35], ["Raisins", 0.3]], priceAdd: 1500, description: "A chewy cookie with rolled oats and raisins, combining a hearty bite with a gentle sourdough note." },
      { name: "Walnut sourdough chocolate-chip cookies", slug: "walnut", additions: [["Walnuts", 0.28]], priceAdd: 2000, description: "Chocolate-chip cookies with toasted walnut pieces for a crisp, nutty contrast to the soft centre." },
    ],
  },
  {
    category: "Pies and pastries",
    saleUnit: "piece",
    products: [
      { slug: "sourdough-pie-crust", name: "Sourdough Pie Crust", flavour: "Classic", price: 12000, yield: 8, description: "A flaky pastry crust with a light sourdough tang, ready for sweet fruit fillings or savoury pies.", ingredients: [["All-purpose flour", 1.5], ["Active sourdough starter", 0.45], ["Unsalted butter", 0.8], ["Fine salt", 0.025], ["Water", 0.2]] },
      { slug: "sourdough-galette", name: "Sourdough Fruit Galette", flavour: "Seasonal fruit", price: 18000, yield: 6, description: "A rustic free-form pastry with a flaky sourdough crust and a seasonal fruit filling, finished with a golden edge.", ingredients: [["All-purpose flour", 1.3], ["Active sourdough starter", 0.35], ["Unsalted butter", 0.65], ["Apples", 0.9], ["Sugar", 0.25], ["Fine salt", 0.02], ["Ground cinnamon", 0.015]] },
      { slug: "sourdough-canele", name: "Sourdough Canelé", flavour: "Vanilla and rum", price: 6000, yield: 20, description: "A small French-style pastry with a dark caramelised shell, custardy centre and a nuanced sourdough aroma.", ingredients: [["All-purpose flour", 0.35], ["Active sourdough starter", 0.25], ["Whole milk", 1.2], ["Sugar", 0.55], ["Eggs", 0.35], ["Unsalted butter", 0.12], ["Vanilla", 0.02], ["Rum flavouring", 0.015], ["Fine salt", 0.01]] },
    ],
    flavours: [
      { name: "Cinnamon-apple sourdough pie crust", slug: "cinnamon-apple", additions: [["Ground cinnamon", 0.025], ["Brown sugar", 0.12]], priceAdd: 1500, description: "A lightly sweet pastry shell with cinnamon notes, suited to apple and other spiced fruit fillings." },
      { name: "Herb sourdough pie crust", slug: "herb", additions: [["Herb blend", 0.035]], priceAdd: 1000, description: "A savoury pastry variation with fragrant herbs for quiches, vegetable pies and other savoury fillings." },
    ],
  },
  {
    category: "Products from leftover sourdough bread",
    saleUnit: "pack",
    products: [
      { slug: "sourdough-croutons", name: "Sourdough Croutons", flavour: "Garlic and herb", price: 7000, yield: 20, description: "Crisp, seasoned cubes made from day-old sourdough bread, prepared as a ready-to-use topping for soups and salads.", ingredients: [["Day-old sourdough bread", 2.5], ["Olive oil", 0.25], ["Garlic", 0.06], ["Herb blend", 0.035], ["Fine salt", 0.025]] },
      { slug: "sourdough-breadcrumbs", name: "Sourdough Breadcrumbs", flavour: "Plain", price: 6000, yield: 15, description: "Dried and finely milled day-old sourdough bread crumbs for coating, binding and crisp toppings.", ingredients: [["Day-old sourdough bread", 3.0]] },
      { slug: "sourdough-bread-pudding", name: "Sourdough Bread Pudding", flavour: "Vanilla and raisin", price: 18000, yield: 8, description: "A baked pudding that transforms day-old sourdough into a soft, custardy dessert with vanilla and sweet raisins.", ingredients: [["Day-old sourdough bread", 2.0], ["Whole milk", 1.2], ["Eggs", 0.5], ["Sugar", 0.3], ["Raisins", 0.25], ["Vanilla", 0.02], ["Ground cinnamon", 0.015]] },
    ],
    flavours: [
      { name: "Rosemary sourdough croutons", slug: "rosemary", additions: [["Fresh rosemary", 0.025]], priceAdd: 1000, description: "Crisp sourdough croutons with fragrant rosemary and a light olive-oil seasoning." },
      { name: "Smoky paprika sourdough croutons", slug: "smoky-paprika", additions: [["Smoked paprika", 0.025]], priceAdd: 1000, description: "A savoury crouton variation seasoned with smoked paprika for a warm, gently smoky flavour." },
    ],
  },
];

const MATERIAL_UNITS = {
  "Bread flour": "kg",
  "Whole-wheat flour": "kg",
  "Rye flour": "kg",
  "Spelt flour": "kg",
  "All-purpose flour": "kg",
  Water: "L",
  "Active sourdough starter": "kg",
  "Fine salt": "kg",
  "Flaky salt": "kg",
  "Mixed seeds": "kg",
  "Sunflower seeds": "kg",
  "Sesame seeds": "kg",
  "Caraway seeds": "kg",
  "Rolled oats": "kg",
  Honey: "kg",
  Sugar: "kg",
  "Brown sugar": "kg",
  "Unsalted butter": "kg",
  "Whole milk": "L",
  Buttermilk: "L",
  "Plain yoghurt": "kg",
  Eggs: "kg",
  "Olive oil": "L",
  "Sunflower oil": "L",
  "Frying oil": "L",
  Raisins: "kg",
  Walnuts: "kg",
  "Dried cranberries": "kg",
  "Dried apricots": "kg",
  "Kalamata olives": "kg",
  "Fresh rosemary": "kg",
  "Herb blend": "kg",
  "Ground cinnamon": "kg",
  "Brown sugar": "kg",
  "Dark chocolate": "kg",
  "Chocolate chips": "kg",
  "Cocoa powder": "kg",
  "Baking powder": "kg",
  "Baking soda": "kg",
  "Vanilla": "L",
  "Rum flavouring": "L",
  Garlic: "kg",
  Onions: "kg",
  Scallions: "kg",
  "Sesame oil": "L",
  "Za'atar spice blend": "kg",
  "Cheddar cheese": "kg",
  Blueberries: "kg",
  Bananas: "kg",
  Apples: "kg",
  "Day-old sourdough bread": "kg",
  "Smoked paprika": "kg",
};

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildRecipe(product, additions = []) {
  const amounts = new Map(product.ingredients.map(([name, quantity]) => [name, quantity]));
  for (const [name, quantity] of additions) amounts.set(name, (amounts.get(name) || 0) + quantity);
  return [...amounts.entries()].map(([name, quantity]) => ({
    materialName: name,
    unit: MATERIAL_UNITS[name],
    quantityPerBatch: quantity,
  }));
}

function allergensFor(ingredients) {
  const names = new Set(ingredients.map((item) => item.materialName));
  const allergens = [];
  if ([...names].some((name) => name.toLowerCase().includes("flour"))) allergens.push("Wheat/gluten");
  if ([...names].some((name) => /milk|butter|yoghurt|buttermilk|cheese/i.test(name))) allergens.push("Milk");
  if (names.has("Eggs")) allergens.push("Eggs");
  if ([...names].some((name) => /sesame/i.test(name))) allergens.push("Sesame");
  if (names.has("Walnuts")) allergens.push("Tree nuts");
  return allergens;
}

function toProfile(product, category, saleUnit, additions = [], flavour = product.flavour, suffix = "", priceAdd = 0, flavourDescription = "") {
  const slug = suffix ? `${product.slug}-${suffix}` : product.slug;
  const ingredientLines = buildRecipe(product, additions);
  const sourceUrl = SOURCE_BY_CATEGORY[category];
  const name = suffix ? `${product.name} - ${flavour}` : product.name;
  const baseUnit = saleUnit === "loaf" ? "loaf" : "piece";
  const packSize = /^pack of (\d+)$/i.exec(saleUnit);
  return {
    code: `SD-${slug.toUpperCase()}`.slice(0, 40),
    seedKey: `sourdough-v1:${slug}`,
    flavourGroup: product.slug,
    slug,
    name,
    category,
    flavour,
    description: flavourDescription || product.description,
    baseUnit,
    shelfLifeDays: product.shelfLifeDays || 2,
    dateLabelType: "best_before",
    storageInstructions: "Store sealed in a cool, dry place; confirm the final label and shelf-life policy before sale.",
    active: false,
    storefront: {
      published: false,
      slug,
      description: flavourDescription || product.description,
      ingredientsStatement: ingredientLines.map((item) => item.materialName).join(", "),
      allergens: allergensFor(ingredientLines),
      images: [],
    },
    variants: [{
      sku: `SD-${slug.toUpperCase()}`.slice(0, 40),
      name: `${flavour} ${saleUnit}`,
      saleUnit,
      unitsPerSaleUnit: packSize ? Number(packSize[1]) : saleUnit === "pack" ? 6 : 1,
      price: product.price + priceAdd,
    }],
    recipe: {
      batchYield: product.yield,
      yieldUnit: baseUnit === "loaf" ? "loaf" : "piece",
      ingredients: ingredientLines,
      sourceReferences: [sourceUrl],
      formulationNote: "Illustrative proposed formulation adapted for review; validate by test bake before production.",
    },
    priceBasis: "Proposed Kampala retail estimate; owner review required.",
  };
}

function buildCatalog() {
  const families = [];
  for (const section of PRODUCTS) {
    for (const product of section.products) {
      families.push(toProfile(product, section.category, section.saleUnit));
    }
    const flavourBase = section.products[0];
    for (const flavour of section.flavours) {
      families.push(toProfile(
        flavourBase,
        section.category,
        section.saleUnit,
        flavour.additions,
        flavour.name,
        flavour.slug,
        flavour.priceAdd,
        flavour.description,
      ));
    }
  }
  const materialDefinitions = [...new Set(
    families.flatMap((family) => family.recipe.ingredients.map((item) => item.materialName)),
  )].map((name) => ({
    code: `SD-ING-${slugify(name).toUpperCase()}`.slice(0, 40),
    name,
    category: "Ingredients",
    unit: MATERIAL_UNITS[name],
    trackingMode: "recipe-consumption",
    lotTrackingRequired: false,
  }));
  return {
    version: 1,
    currency: "UGX",
    pricingBasis: "Proposed estimates; owner review required.",
    productCountByCategory: Object.fromEntries(PRODUCTS.map((section) => [
      section.category,
      section.products.length + section.flavours.length,
    ])),
    families,
    materialDefinitions,
  };
}

module.exports = {
  MATERIAL_UNITS,
  PRODUCTS,
  SOURCE_BY_CATEGORY,
  buildCatalog,
};

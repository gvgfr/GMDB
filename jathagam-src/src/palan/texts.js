// Traditional significations used by the palan (interpretation) generator.
// Sources: classical Tamil/Parasari conventions (Brihat Parasara Hora Sastra,
// Phaladeepika) as commonly taught. Deliberately excluded: lifespan, death,
// illness predictions and fear-based dosham verdicts.

export const KARAKA = {
  sun: { en: 'authority, father, self-confidence, government, reputation', ta: 'அதிகாரம், தந்தை, தன்னம்பிக்கை, அரசு, புகழ்' },
  moon: { en: 'mind, mother, emotions, comfort, public contact', ta: 'மனம், தாய், உணர்வுகள், சுகம், மக்கள் தொடர்பு' },
  mars: { en: 'energy, courage, siblings, land and property, drive', ta: 'சக்தி, தைரியம், உடன்பிறப்புகள், நிலம் மற்றும் சொத்து, செயல்வேகம்' },
  mercury: { en: 'intellect, speech, learning, trade, communication', ta: 'அறிவு, பேச்சு, கல்வி, வியாபாரம், தொடர்புத் திறன்' },
  jupiter: { en: 'wisdom, children, fortune, teachers, dharma', ta: 'ஞானம், குழந்தைகள், அதிர்ஷ்டம், குரு, தர்மம்' },
  venus: { en: 'love, marriage, beauty, arts, comforts and vehicles', ta: 'அன்பு, திருமணம், அழகு, கலைகள், சுகபோகம், வாகனம்' },
  saturn: { en: 'discipline, hard work, service, patience, lasting effort', ta: 'ஒழுக்கம், கடின உழைப்பு, சேவை, பொறுமை, நீடித்த முயற்சி' },
  rahu: { en: 'ambition, foreign connections, unconventional paths, sudden opportunities', ta: 'லட்சியம், வெளிநாட்டுத் தொடர்பு, மாறுபட்ட பாதைகள், திடீர் வாய்ப்புகள்' },
  ketu: { en: 'detachment, spirituality, research, insight', ta: 'பற்றின்மை, ஆன்மிகம், ஆராய்ச்சி, உள்ளுணர்வு' },
};

export const HOUSE = [
  null,
  { en: 'self, personality, appearance and the overall direction of life', ta: 'தன்னிலை, குணம், தோற்றம், வாழ்க்கைப் போக்கு' },
  { en: 'family, wealth, speech and food', ta: 'குடும்பம், தனம், வாக்கு, உணவு' },
  { en: 'courage, younger siblings, short journeys and personal effort', ta: 'தைரியம், இளைய உடன்பிறப்புகள், குறுகிய பயணம், சொந்த முயற்சி' },
  { en: 'mother, home, property, vehicles, schooling and peace of mind', ta: 'தாய், வீடு, சொத்து, வாகனம், கல்வி, மன நிம்மதி' },
  { en: 'children, intelligence, creativity, higher learning and past merit', ta: 'குழந்தைகள், புத்திக்கூர்மை, படைப்பாற்றல், உயர்கல்வி, பூர்வ புண்ணியம்' },
  { en: 'daily work, service, competition, debts and overcoming obstacles', ta: 'அன்றாடப் பணி, சேவை, போட்டி, கடன், தடைகளை வெல்லுதல்' },
  { en: 'marriage, spouse, partnerships and business dealings', ta: 'திருமணம், வாழ்க்கைத் துணை, கூட்டாண்மை, வியாபார உறவுகள்' },
  { en: 'inheritance, research, hidden matters and sudden changes', ta: 'பரம்பரைச் சொத்து, ஆராய்ச்சி, மறைவான விஷயங்கள், திடீர் மாற்றங்கள்' },
  { en: 'father, fortune, dharma, teachers and long journeys', ta: 'தந்தை, பாக்கியம், தர்மம், குரு, தொலைதூரப் பயணம்' },
  { en: 'career, status, public action and recognition', ta: 'தொழில், அந்தஸ்து, செயல்கள், அங்கீகாரம்' },
  { en: 'gains, income, elder siblings, friends and fulfilment of wishes', ta: 'லாபம், வருமானம், மூத்த உடன்பிறப்புகள், நண்பர்கள், ஆசைகள் நிறைவேறுதல்' },
  { en: 'expenses, foreign lands, spirituality and rest', ta: 'செலவுகள், வெளிநாடு, ஆன்மிகம், ஓய்வு' },
];

export const SIGN_TRAITS = [
  { en: 'energetic, direct and quick to take the initiative', ta: 'சுறுசுறுப்பு, நேர்மை, முன்முயற்சி எடுக்கும் வேகம்' },
  { en: 'steady, patient, loyal and fond of comfort and security', ta: 'நிதானம், பொறுமை, விசுவாசம், சுகமும் பாதுகாப்பும் விரும்புதல்' },
  { en: 'curious, communicative, adaptable and quick-witted', ta: 'ஆர்வம், பேச்சுத்திறன், தகவமைப்பு, கூர்மையான அறிவு' },
  { en: 'caring, sensitive and attached to home and family', ta: 'அக்கறை, உணர்திறன், வீடு குடும்பத்தின் மீது பற்று' },
  { en: 'confident, generous, dignified and a natural leader', ta: 'தன்னம்பிக்கை, தாராள மனம், கௌரவம், தலைமைப் பண்பு' },
  { en: 'practical, analytical, careful and service-minded', ta: 'நடைமுறை அறிவு, பகுப்பாய்வு, கவனம், சேவை மனப்பான்மை' },
  { en: 'balanced, diplomatic, artistic and fair-minded', ta: 'சமநிலை, இராஜதந்திரம், கலையுணர்வு, நியாய உணர்வு' },
  { en: 'intense, determined, private and deep-thinking', ta: 'தீவிரம், உறுதி, ரகசியம் காத்தல், ஆழ்ந்த சிந்தனை' },
  { en: 'optimistic, principled and fond of learning and travel', ta: 'நம்பிக்கை, கொள்கைப் பிடிப்பு, கல்வி மற்றும் பயண ஆர்வம்' },
  { en: 'disciplined, ambitious, responsible and a patient builder', ta: 'ஒழுக்கம், லட்சியம், பொறுப்புணர்வு, பொறுமையான உழைப்பு' },
  { en: 'independent, humanitarian, inventive and thoughtful', ta: 'சுதந்திர மனம், மனிதநேயம், புதுமை, சிந்தனை' },
  { en: 'compassionate, imaginative, spiritual and adaptable', ta: 'இரக்கம், கற்பனைத் திறன், ஆன்மிகம், இணக்கம்' },
];

export const NAK_TRAITS = [
  { en: 'quick, healing and adventurous', ta: 'வேகம், குணப்படுத்தும் தன்மை, சாகசம்' },
  { en: 'determined, responsible and strong-willed', ta: 'உறுதி, பொறுப்பு, மன வலிமை' },
  { en: 'sharp, courageous and outspoken', ta: 'கூர்மை, தைரியம், வெளிப்படையான பேச்சு' },
  { en: 'attractive, artistic and fond of comfort', ta: 'கவர்ச்சி, கலையுணர்வு, சுக விருப்பம்' },
  { en: 'curious, searching and gentle', ta: 'தேடல், ஆர்வம், மென்மை' },
  { en: 'intellectual, intense and transforming', ta: 'அறிவுத்திறன், தீவிரம், மாற்றம்' },
  { en: 'renewing, optimistic and generous', ta: 'புதுப்பித்தல், நம்பிக்கை, தாராளம்' },
  { en: 'nurturing, dutiful and devoted', ta: 'பேணுதல், கடமையுணர்வு, பக்தி' },
  { en: 'perceptive, shrewd and persuasive', ta: 'நுண்ணறிவு, சாதுர்யம், வசீகரப் பேச்சு' },
  { en: 'dignified, proud of heritage and inclined to lead', ta: 'கௌரவம், பாரம்பரியப் பெருமை, தலைமை' },
  { en: 'pleasure-loving, creative and sociable', ta: 'மகிழ்ச்சி, படைப்பாற்றல், நட்புணர்வு' },
  { en: 'helpful, reliable and generous', ta: 'உதவும் மனம், நம்பகத்தன்மை, தாராளம்' },
  { en: 'skilful, clever with the hands and practical', ta: 'கைத்திறன், சாமர்த்தியம், நடைமுறை அறிவு' },
  { en: 'creative, stylish and a builder', ta: 'படைப்பாற்றல், அழகுணர்வு, உருவாக்கும் திறன்' },
  { en: 'independent, flexible and business-minded', ta: 'சுதந்திரம், நெகிழ்வு, வியாபார நுட்பம்' },
  { en: 'goal-driven, ambitious and persistent', ta: 'இலக்கு நோக்கு, லட்சியம், விடாமுயற்சி' },
  { en: 'loyal, disciplined and friendly', ta: 'விசுவாசம், ஒழுக்கம், நட்பு' },
  { en: 'protective, resourceful and responsible', ta: 'பாதுகாக்கும் தன்மை, சமயோசிதம், பொறுப்புணர்வு' },
  { en: 'probing, philosophical and keen to reach the root of things', ta: 'ஆழ்ந்த தேடல், தத்துவ சிந்தனை, அடிப்படையை ஆராய்தல்' },
  { en: 'confident, persuasive and hard to defeat', ta: 'தன்னம்பிக்கை, வசீகரம், தளராத மனம்' },
  { en: 'principled, steady and aimed at lasting success', ta: 'கொள்கை, நிலைத்தன்மை, நீடித்த வெற்றி' },
  { en: 'a good listener, learned and respectful', ta: 'கேட்கும் திறன், கல்வியறிவு, மரியாதை' },
  { en: 'musical, energetic and prosperity-minded', ta: 'இசையார்வம், சுறுசுறுப்பு, செல்வ நோக்கு' },
  { en: 'healing, independent and private', ta: 'குணப்படுத்தும் தன்மை, சுதந்திரம், ரகசியம் காத்தல்' },
  { en: 'idealistic, intense and generous', ta: 'இலட்சியவாதம், தீவிரம், தாராளம்' },
  { en: 'calm, wise and self-controlled', ta: 'அமைதி, ஞானம், சுயகட்டுப்பாடு' },
  { en: 'kind, gentle and protective of others', ta: 'கருணை, மென்மை, பிறரைக் காக்கும் மனம்' },
];

export const DASA_THEME = {
  sun: { en: 'recognition, dealings with authority and government, and focus on self and father', ta: 'அங்கீகாரம், அதிகாரம் மற்றும் அரசு தொடர்புகள், தன்னிலை மற்றும் தந்தை சார்ந்த விஷயங்கள்' },
  moon: { en: 'emotional life, home, mother, travel and public contact', ta: 'உணர்வு வாழ்க்கை, வீடு, தாய், பயணம், மக்கள் தொடர்பு' },
  mars: { en: 'energy, property and land matters, competition and siblings', ta: 'செயல்வேகம், நிலம் மற்றும் சொத்து விஷயங்கள், போட்டி, உடன்பிறப்புகள்' },
  mercury: { en: 'learning, business, communication and new skills', ta: 'கல்வி, வியாபாரம், தொடர்புத் திறன், புதிய திறமைகள்' },
  jupiter: { en: 'growth, learning, children, prosperity and good guidance', ta: 'வளர்ச்சி, கல்வி, குழந்தைகள், செழிப்பு, நல்ல வழிகாட்டுதல்' },
  venus: { en: 'relationships, marriage, comforts, arts and enjoyment', ta: 'உறவுகள், திருமணம், சுகபோகம், கலைகள், மகிழ்ச்சி' },
  saturn: { en: 'steady hard work, responsibility and slow but lasting results', ta: 'நிலையான கடின உழைப்பு, பொறுப்பு, மெதுவான ஆனால் நீடித்த பலன்கள்' },
  rahu: { en: 'ambition, rapid change, foreign connections and unconventional opportunities', ta: 'லட்சியம், விரைவான மாற்றங்கள், வெளிநாட்டுத் தொடர்பு, மாறுபட்ட வாய்ப்புகள்' },
  ketu: { en: 'turning inward, spiritual interests, letting go and research', ta: 'அகநோக்கு, ஆன்மிக ஈடுபாடு, பற்றை விடுதல், ஆராய்ச்சி' },
};

// Exaltation (uchcham) signs; debilitation (neecham) is the opposite sign.
export const EXALTATION = { sun: 0, moon: 1, mars: 9, mercury: 5, jupiter: 3, venus: 11, saturn: 6 };
export const BENEFICS = new Set(['moon', 'mercury', 'jupiter', 'venus']);
export const UPACHAYA = new Set([3, 6, 10, 11]);

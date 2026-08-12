import re

class SimpleSentiment:
    def __init__(self):
        # Basic financial lexicon
        self.positive_words = {
            'growth', 'gain', 'rally', 'surge', 'jump', 'up', 'rise', 'record', 'high', 'profit',
            'revenue', 'beat', 'exceed', 'outperform', 'upgrade', 'buy', 'bull', 'bullish',
            'positive', 'optimistic', 'strong', 'solid', 'higher', 'climb', 'recover', 'green'
        }
        self.negative_words = {
            'loss', 'drop', 'fall', 'decline', 'plunge', 'down', 'low', 'miss', 'missed',
            'underperform', 'downgrade', 'sell', 'bear', 'bearish', 'negative', 'pessimistic',
            'weak', 'soft', 'lower', 'tumble', 'crash', 'red', 'risk', 'fail', 'concern'
        }

    def analyze(self, text):
        if not text:
            return 0.0
            
        words = re.findall(r'\w+', text.lower())
        if not words:
            return 0.0
            
        score = 0
        for word in words:
            if word in self.positive_words:
                score += 1
            elif word in self.negative_words:
                score -= 1
                
        # Normalize score between -1 and 1
        # We assume a sentence rarely has more than 5 charged words
        normalized = max(min(score / 5.0, 1.0), -1.0)
        return normalized

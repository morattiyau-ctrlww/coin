class CoinFlip {
    constructor() {
        this.coin = document.getElementById('coin');
        this.flipBtn = document.getElementById('flipBtn');
        this.historyList = document.getElementById('history');
        this.history = JSON.parse(localStorage.getItem('coinFlipHistory')) || [];
        this.isFlipping = false;
        
        this.init();
    }
    
    init() {
        this.flipBtn.addEventListener('click', () => this.flipCoin());
        this.coin.addEventListener('click', () => this.flipCoin());
        this.updateHistoryDisplay();
    }
    
    flipCoin() {
        if (this.isFlipping) return;
        
        this.isFlipping = true;
        this.flipBtn.disabled = true;
        
        // Random result
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        
        // Remove any existing animation and result classes
        this.coin.classList.remove('flipping-heads', 'flipping-tails', 'result-heads', 'result-tails');
        
        // Add appropriate animation class
        setTimeout(() => {
            this.coin.classList.add(`flipping-${result}`);
        }, 10);
        
        // Handle animation end
        setTimeout(() => {
            this.coin.classList.remove('flipping-heads', 'flipping-tails');
            this.coin.classList.add(`result-${result}`);
            this.addToHistory(result);
            this.isFlipping = false;
            this.flipBtn.disabled = false;
        }, 2000);
    }
    
    addToHistory(result) {
        const timestamp = new Date().toLocaleTimeString();
        const flipResult = {
            result: result,
            time: timestamp
        };
        
        // Add to beginning of array
        this.history.unshift(flipResult);
        
        // Keep only last 5 flips
        if (this.history.length > 5) {
            this.history = this.history.slice(0, 5);
        }
        
        // Save to localStorage
        localStorage.setItem('coinFlipHistory', JSON.stringify(this.history));
        
        // Update display
        this.updateHistoryDisplay();
    }
    
    updateHistoryDisplay() {
        this.historyList.innerHTML = '';
        
        if (this.history.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.textContent = 'No flips yet - click the coin!';
            emptyItem.classList.add('empty-history');
            this.historyList.appendChild(emptyItem);
            return;
        }
        
        this.history.forEach((flip, index) => {
            const listItem = document.createElement('li');
            listItem.textContent = `${index + 1}. ${flip.result.toUpperCase()} - ${flip.time}`;
            listItem.classList.add(flip.result);
            this.historyList.appendChild(listItem);
        });
    }
}

// Initialize the coin flip game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new CoinFlip();
});
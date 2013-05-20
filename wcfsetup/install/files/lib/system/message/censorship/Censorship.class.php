<?php
namespace wcf\system\message\censorship;
use wcf\system\SingletonFactory;
use wcf\util\ArrayUtil;
use wcf\util\StringUtil;

/**
 * Finds censored words.
 * 
 * @author	Marcel Werk
 * @copyright	2001-2013 WoltLab GmbH
 * @license	GNU Lesser General Public License <http://opensource.org/licenses/lgpl-license.php>
 * @package	com.woltlab.wcf.message
 * @subpackage	system.message.censorship
 * @category	Community Framework
 */
class Censorship extends SingletonFactory {
	/**
	 * censored words
	 * @var array<string>
	 */
	protected $censoredWords = array();
	
	/**
	 * word delimiters
	 * @var	string
	 */
	protected $delimiters = '[\s\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]';
	
	/**
	 * list of words
	 * @var	array<string>
	 */
	protected $words = array();
	
	/**
	 * list of matches
	 * @var	array
	 */
	protected $matches = array();
	
	/**
	 * @see wcf\system\SingletonFactory::init()
	 */
	protected function init() {
		// get words which should be censored
		$censoredWords = explode("\n", StringUtil::unifyNewlines(StringUtil::toLowerCase(CENSORED_WORDS)));
		
		// format censored words
		$this->censoredWords = ArrayUtil::trim($censoredWords);
	}
	
	/**
	 * Returns censored words from a text.
	 * 
	 * @param	string		$text
	 * @return	mixed		$matches / false
	 */
	public function test($text) {
		// reset values
		$this->matches = $this->words = array();
		
		// string to lower case
		$text = StringUtil::toLowerCase($text);
		
		// ignore bbcode tags
		$text = preg_replace('~\[/?[a-z]+[^\]]*\]~i', '', $text);
		
		// split the text in single words
		$this->words = preg_split("!".$this->delimiters."+!", $text, -1, PREG_SPLIT_NO_EMPTY);
		
		// check each word if it's censored.
		for ($i = 0, $count = count($this->words); $i < $count; $i++) {
			$word = $this->words[$i];
			foreach ($this->censoredWords as $censoredWord) {
				// check for direct matches ("badword" == "badword")
				if ($censoredWord == $word) {
					// store censored word
					if (isset($this->matches[$word])) {
						$this->matches[$word]++;
					}
					else {
						$this->matches[$word] = 1;
					}
						
					continue 2;
				}
				// check for asterisk matches ("*badword*" == "FooBadwordBar")
				else if (StringUtil::indexOf($censoredWord, '*') !== false) {
					$censoredWord = StringUtil::replace('\*', '.*', preg_quote($censoredWord));
					if (preg_match('!^'.$censoredWord.'$!', $word)) {
						// store censored word
						if (isset($this->matches[$word])) {
							$this->matches[$word]++;
						}
						else {
							$this->matches[$word] = 1;
						}
						
						continue 2;
					}
				}
				// check for partial matches ("~badword~" == "bad-word")
				else if (StringUtil::indexOf($censoredWord, '~') !== false) {
					$censoredWord = StringUtil::replace('~', '', $censoredWord);
					if (($position = StringUtil::indexOf($censoredWord, $word)) !== false) {
						if ($position > 0) {
							// look behind
							if (!$this->lookBehind($i - 1, StringUtil::substring($censoredWord, 0, $position))) {
								continue;
							}
						}
						
						if ($position + StringUtil::length($word) < StringUtil::length($censoredWord)) {
							// look ahead
							if (($newIndex = $this->lookAhead($i + 1, StringUtil::substring($censoredWord, $position + StringUtil::length($word))))) {
								$i = $newIndex;
							}
							else {
								continue;
							}
						}
						
						// store censored word
						if (isset($this->matches[$censoredWord])) {
							$this->matches[$censoredWord]++;
						}
						else {
							$this->matches[$censoredWord] = 1;
						}
						
						continue 2;
					}
				}
			}
		}
		
		// at least one censored word was found
		if (count($this->matches) > 0) {
			return $this->matches;
		}
		// text is clean
		else {
			return false;
		}
	}
	
	/**
	 * Looks behind in the word list.
	 * 
	 * @param	integer		$index
	 * @param	string		$search
	 * @return	boolean
	 */
	protected function lookBehind($index, $search) {
		if (isset($this->words[$index])) {
			if (StringUtil::indexOf($this->words[$index], $search) === (StringUtil::length($this->words[$index]) - StringUtil::length($search))) {
				return true;
			}
			else if (StringUtil::indexOf($search, $this->words[$index]) === (StringUtil::length($search) - StringUtil::length($this->words[$index]))) {
				return $this->lookBehind($index - 1, 0, (StringUtil::length($search) - StringUtil::length($this->words[$index])));
			}
		}
		
		return false;
	}
	
	/**
	 * Looks ahead in the word list.
	 * 
	 * @param	integer		$index
	 * @param	string		$search
	 * @return	mixed
	 */
	protected function lookAhead($index, $search) {
		if (isset($this->words[$index])) {
			if (StringUtil::indexOf($this->words[$index], $search) === 0) {
				return $index;
			}
			else if (StringUtil::indexOf($search, $this->words[$index]) === 0) {
				return $this->lookAhead($index + 1, StringUtil::substring($search, StringUtil::length($this->words[$index])));
			}
		}
		
		return false;
	}
}

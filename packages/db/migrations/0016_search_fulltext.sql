-- Full-text search over profile entries (positions, biography, accomplishments), so
-- readers can find candidates by what they have said or done. Names, races and issues
-- are short and searched with plain matching instead.
ALTER TABLE `claim` ADD FULLTEXT INDEX `claim_text_ft` (`title`, `summary`);

CREATE TRIGGER update_utility_length_canonical_updated_at
  BEFORE UPDATE ON utility_length_canonical
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

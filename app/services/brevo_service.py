import requests
import logging

logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3"

class BrevoService:
    def __init__(self, api_key: str, sender_email: str, sender_name: str):
        self.api_key = api_key
        self.sender = {"email": sender_email, "name": sender_name}
        self.headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": api_key
        }

    def create_contact(self, email: str, name: str):
        url = f"{BREVO_API_URL}/contacts"
        # Split name into first and last if possible, or just put in FIRSTNAME
        # Brevo standard attributes: FIRSTNAME, LASTNAME
        # We'll just put it all in FIRSTNAME for simplicity if not parsed, or try to split.
        parts = name.strip().split(' ', 1)
        attributes = {"FIRSTNAME": parts[0]}
        if len(parts) > 1:
            attributes["LASTNAME"] = parts[1]

        payload = {
            "email": email,
            "attributes": attributes,
            "updateEnabled": True 
        }
        
        try:
            response = requests.post(url, json=payload, headers=self.headers)
            if response.status_code in [201, 204]:
                return True, None
            # If contact already exists (409), that's fine for us, we proceed to send.
            if response.status_code == 409:
                return True, "Contact already exists"
                
            return False, response.text
        except Exception as e:
            logger.error(f"Error creating contact: {e}")
            return False, str(e)

    def send_email(self, email: str, name: str, subject: str, html_content: str):
        url = f"{BREVO_API_URL}/smtp/email"
        payload = {
            "sender": self.sender,
            "to": [{"email": email, "name": name}],
            "subject": subject,
            "htmlContent": html_content
        }
        
        try:
            response = requests.post(url, json=payload, headers=self.headers)
            if response.status_code in [201, 200, 202]:
                return True, response.json().get("messageId")
            return False, response.text
        except Exception as e:
            logger.error(f"Error sending email: {e}")
            return False, str(e)

    def get_email_status(self, message_id: str):
        url = f"{BREVO_API_URL}/smtp/emails/{message_id}"
        try:
            response = requests.get(url, headers=self.headers)
            if response.status_code == 200:
                return response.json()
            return None
        except Exception:
            return None

    def delete_contact(self, email: str):
        # We need to URL encode the email if it has special chars, but usually pure email is fine or requires simple quoting? 
        # Brevo docs say /contacts/{identifier}. Identifier is email.
        # It's safest to rely on requests working, but let's just ensure we haven't messed up the path.
        import urllib.parse
        encoded_email = urllib.parse.quote(email)
        url = f"{BREVO_API_URL}/contacts/{encoded_email}"
        
        try:
            response = requests.delete(url, headers=self.headers)
            if response.status_code in [204, 200, 404]: # 404 means already gone, which is success for us
                return True, None
            return False, response.text
        except Exception as e:
            logger.error(f"Error deleting contact: {e}")
            return False, str(e)

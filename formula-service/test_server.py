import base64
import importlib.util
import json
import pathlib
import threading
import unittest
from http import HTTPStatus
from urllib.error import HTTPError
from urllib.request import Request, urlopen


MODULE_PATH = pathlib.Path(__file__).with_name("server.py")
SPEC = importlib.util.spec_from_file_location("studysky_formula_server", MODULE_PATH)
assert SPEC and SPEC.loader
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class FormulaServiceTests(unittest.TestCase):
    def test_results_are_filtered_and_sorted_in_reading_order(self):
        result = SERVER.extract_formula_results(
            {
                "res": {
                    "formula_res_list": [
                        {"rec_formula": " y = 2 ", "dt_polys": [[50, 100, 200, 130]]},
                        {"rec_formula": "", "dt_polys": [[0, 0, 1, 1]]},
                        {"rec_formula": "x = 1", "dt_polys": [[20, 20, 180, 50]]},
                    ]
                }
            }
        )
        self.assertEqual(
            result,
            [
                {"latex": "x = 1", "box": [20.0, 20.0, 180.0, 50.0]},
                {"latex": "y = 2", "box": [50.0, 100.0, 200.0, 130.0]},
            ],
        )

    def test_direct_formula_result_can_have_no_box(self):
        self.assertEqual(
            SERVER.extract_formula_results(
                {"formula_res_list": [{"rec_formula": r"x^{2}+y^{2}=z^{2}"}]}
            ),
            [{"latex": r"x^{2}+y^{2}=z^{2}", "box": None}],
        )

    def test_request_decoder_rejects_invalid_and_oversized_images(self):
        with self.assertRaises(SERVER.ClientError) as invalid:
            SERVER.decode_request_payload({"image": "not base64", "mode": "page"}, 100)
        self.assertEqual(invalid.exception.status, HTTPStatus.BAD_REQUEST)

        encoded = base64.b64encode(b"a" * 101).decode("ascii")
        with self.assertRaises(SERVER.ClientError) as oversized:
            SERVER.decode_request_payload({"image": encoded, "mode": "formula"}, 100)
        self.assertEqual(oversized.exception.status, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        self.assertGreater(SERVER.encoded_request_limit(12 * 1024 * 1024), 16 * 1024 * 1024)

    def test_private_endpoint_requires_the_shared_token(self):
        class FakeRecognizer:
            calls = 0

            def predict(self, image, mode):
                self.calls += 1
                self.last_input = (image, mode)
                return [{"latex": "x=1", "box": None}]

        recognizer = FakeRecognizer()
        token = "t" * 32
        server = SERVER.FormulaHTTPServer(("127.0.0.1", 0), recognizer, token, 100)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        endpoint = f"http://127.0.0.1:{server.server_port}/v1/formula"
        body = json.dumps(
            {
                "image": base64.b64encode(b"synthetic-image").decode("ascii"),
                "mode": "formula",
            }
        ).encode("utf-8")

        try:
            unauthorized = Request(
                endpoint,
                data=body,
                headers={"content-type": "application/json"},
                method="POST",
            )
            with self.assertRaises(HTTPError) as denied:
                urlopen(unauthorized, timeout=3)
            self.assertEqual(denied.exception.code, HTTPStatus.UNAUTHORIZED)
            self.assertEqual(recognizer.calls, 0)

            authorized = Request(
                endpoint,
                data=body,
                headers={
                    "authorization": f"Bearer {token}",
                    "content-type": "application/json",
                },
                method="POST",
            )
            with urlopen(authorized, timeout=3) as response:
                result = json.load(response)
            self.assertEqual(result["formulas"], [{"latex": "x=1", "box": None}])
            self.assertEqual(recognizer.last_input, (b"synthetic-image", "formula"))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()

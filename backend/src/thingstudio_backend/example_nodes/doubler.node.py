# Example custom node: multiplies the payload by `factor`.
# Edit or delete this file freely. See the Writing custom nodes page in the docs.

async def run(msg, properties):
    msg['payload'] = msg['payload'] * properties['factor']
    return msg

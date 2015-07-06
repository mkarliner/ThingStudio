Template.DocTable.onCreated(function(){
	console.log("DTR ", this)
})


Template.DocTable.helpers({
	tableheader: function(name){
		console.log("TDATA ", name, this)
		return Tables[name][0];
	},
	tabledata: function(name){
		console.log("TDATA ", name, this)
		return Tables[name];
	},
	columns: function(){
		console.log("COLS ", this)
		row = this;
		cols = [];
		for(var propertyName in row) {
			cols.push({key: propertyName, value: row[propertyName]});
		}
		return cols;
	}
})